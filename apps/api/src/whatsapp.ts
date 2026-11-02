import { createDb, whatsappMessages } from "@komugo/db";
import { and, eq, sql } from "drizzle-orm";
import type { Locale } from "./details";
import { HOUR, log, logError } from "./lib";

type WhatsApp = { to: string; text: string };

export const devOutbox: (WhatsApp & { at: number })[] = [];

// Fixed text with {slots}, so each can become an approved WhatsApp Cloud API template later (ADR 0006).
const TEMPLATES = {
  welcome: {
    en: [
      "Hi {contact}, this is Komugo. We'll send {operator}'s bookings to this number. Please save this number and reply \"OK\" so our messages reach you.",
      "Each time a Ticket is booked, cancelled or moved, we send a Booking alert straight away with a link to that day's Day list: its Tickets with time, court, Customer name and Ticket code.",
      "The Day list needs no sign-in and stays up to date until the day ends. On the day itself you can close a time from it.",
    ].join("\n\n"),
    ms: [
      "Salam {contact}, ini Komugo. Kami akan menghantar tempahan {operator} ke nombor ini. Sila simpan nombor ini dan balas \"OK\" supaya mesej kami sampai kepada anda.",
      "Setiap kali tiket ditempah, dibatalkan atau dipindahkan, kami terus hantar makluman tempahan dengan pautan ke senarai harian hari itu: tiketnya dengan masa, gelanggang, nama pelanggan dan kod tiket.",
      "Senarai harian tidak perlu log masuk dan sentiasa terkini sehingga hari itu tamat. Pada hari itu sendiri anda boleh menutup sesuatu masa daripadanya.",
    ].join("\n\n"),
  },
  alert: {
    en: "{operator}: Booking alert for {date}\n\n{change}\n\nDay list, always up to date: {link}",
    ms: "{operator}: Makluman tempahan untuk {date}\n\n{change}\n\nSenarai harian, sentiasa terkini: {link}",
  },
  closure: {
    en: "{operator}: Closure done\n\n{option}, {when}\nReason: {reason}\nCustomers notified: {customers}",
    ms: "{operator}: Penutupan selesai\n\n{option}, {when}\nSebab: {reason}\nPelanggan dimaklumkan: {customers}",
  },
  payout: {
    en: "{operator}: Payout for {month}\n\nSales: {sales}\nCommission: {commission}\nRefunds: {refunds}{carried}\nAmount paid: {amount}",
    ms: "{operator}: Bayaran pengendali untuk {month}\n\nJualan: {sales}\nKomisen: {commission}\nBayaran balik: {refunds}{carried}\nAmaun dibayar: {amount}",
  },
} satisfies Record<string, Record<Locale, string>>;

type Template = keyof typeof TEMPLATES;

const render = (t: Template, l: Locale, slots: Record<string, string>) => TEMPLATES[t][l].replace(/\{(\w+)\}/g, (_, k: string) => slots[k]);

// connected() is undefined when the status check itself fails, so an outage or rate limit never reads as a disconnected device.
type Sender = { send(m: WhatsApp): Promise<void>; connected(): Promise<boolean | undefined>; gapMs: number };

// Dev and tests unplug the fake device (POST /dev/whatsapp/device) to show the failed-send banner.
export const devDevice = { connected: true };

const logSender: Sender = {
  async send(m) {
    if (!devDevice.connected) throw new Error("device_disconnected");
    console.log(JSON.stringify({ event: "dev_whatsapp", to: m.to, text: m.text }));
    devOutbox.unshift({ ...m, at: Date.now() });
    devOutbox.length = Math.min(devOutbox.length, 50);
  },
  connected: async () => devDevice.connected,
  gapMs: 0,
};

class SendError extends Error {
  constructor(readonly status: number) {
    super(`wasender_${status}`);
  }
}

const WASENDER = "https://www.wasenderapi.com/api";

const wasender = (env: Env): Sender => ({
  async send(m) {
    const res = await fetch(`${WASENDER}/send-message`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WASENDER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: m.to, text: m.text }),
    });
    if (!res.ok) throw new SendError(res.status);
  },
  // TODO(#34): confirm /api/status's status values against a linked session; anything but "connected" counts as disconnected.
  async connected() {
    try {
      const res = await fetch(`${WASENDER}/status`, { headers: { Authorization: `Bearer ${env.WASENDER_API_KEY}` } });
      if (res.ok) return ((await res.json()) as { status?: unknown }).status === "connected";
    } catch {}
  },
  gapMs: Number(env.WASENDER_GAP_MS) || 0,
});

export const sender = (env: Env) => (env.WHATSAPP_MODE === "log" ? logSender : wasender(env));

// Only the newest Welcome per contact is theirs; old Digests (their close links are gone) never; every other message counts for a day. A removed contact's message is shown but never resent.
export const current = sql`case when ${whatsappMessages.template} = 'welcome' then not exists (select 1 from whatsapp_messages n where n.contact_id = ${whatsappMessages.contactId} and n.template = 'welcome' and n.created_at > ${whatsappMessages.createdAt}) when ${whatsappMessages.template} = 'digest' then 0 else ${whatsappMessages.createdAt} > unixepoch() * 1000 - ${24 * HOUR} end`;
const live = sql`exists (select 1 from operator_contacts c where c.id = ${whatsappMessages.contactId})`;

type Contact = { id: string; operatorId: string; phone: string; locale: Locale };

export const message = (env: Env, to: Contact, template: Template, slots: Record<string, string>) =>
  send(env, to, template, render(template, to.locale, slots));

export type Job = { id: string };

export async function send(env: Env, to: Contact, template: Template | "staff", text: string) {
  const [m] = await createDb(env.DB)
    .insert(whatsappMessages)
    .values({ operatorId: to.operatorId, contactId: to.id, phone: to.phone, template, text, status: "queued", createdAt: Date.now() })
    .returning({ id: whatsappMessages.id });
  await enqueue(env, m.id);
}

// A message the queue won't take fails at once, so it shows in the banner with Retry instead of staying queued.
async function enqueue(env: Env, id: string) {
  try {
    await env.WHATSAPP_QUEUE.send({ id } satisfies Job);
  } catch (e) {
    await createDb(env.DB).update(whatsappMessages).set({ status: "failed", error: "queue_unavailable" }).where(eq(whatsappMessages.id, id));
    logError("whatsapp_queue_failed", { messageId: id, error: String(e) });
  }
}

// Re-queues a failed message as it was first written, to the number it went to. Claiming the row first stops two staff sending it twice.
export async function retry(env: Env, id: string) {
  const [m] = await createDb(env.DB)
    .update(whatsappMessages)
    .set({ status: "queued", error: null })
    .where(and(eq(whatsappMessages.id, id), eq(whatsappMessages.status, "failed"), current, live))
    .returning({ id: whatsappMessages.id });
  if (!m) return false;
  await enqueue(env, id);
  log("whatsapp_requeued", { messageId: id });
  return true;
}

// Matches the consumer's max_retries in wrangler.jsonc.
const ATTEMPTS = 8;
const backoff = (attempts: number) => Math.min(10 * 2 ** (attempts - 1), 600);
const retryable = (e: unknown) => !(e instanceof SendError) || e.status === 429 || e.status >= 500;

// The queue runs one batch at a time, so sends go out one by one, gapMs apart. A message fails only on its last attempt, a non-retryable error or a disconnected device.
export async function deliver(batch: MessageBatch<Job>, env: Env) {
  const db = createDb(env.DB);
  const s = sender(env);
  let gap = false;
  for (const msg of batch.messages) {
    const id = msg.body.id;
    try {
      const [m] = await db
        .select()
        .from(whatsappMessages)
        .where(and(eq(whatsappMessages.id, id), eq(whatsappMessages.status, "queued")));
      if (!m) {
        msg.ack();
        continue;
      }
      if (gap && s.gapMs) await new Promise((r) => setTimeout(r, s.gapMs));
      gap = true;
      const e = await s.send({ to: m.phone, text: m.text }).then(
        () => undefined,
        (err: unknown) => err,
      );
      if (!e) {
        // Acked before recording, so a D1 error here never sends it twice.
        msg.ack();
        await db
          .update(whatsappMessages)
          .set({ status: "sent", error: null })
          .where(eq(whatsappMessages.id, id))
          .catch((err) => logError("whatsapp_sent_not_recorded", { messageId: id, error: String(err) }));
        log("whatsapp_sent", { messageId: id, template: m.template, attempts: msg.attempts });
        continue;
      }
      const connected = await s.connected();
      const error = connected === false ? "device_disconnected" : e instanceof Error ? e.message : String(e);
      if (connected !== false && retryable(e) && msg.attempts < ATTEMPTS) {
        msg.retry({ delaySeconds: backoff(msg.attempts) });
        log("whatsapp_retrying", { messageId: id, attempts: msg.attempts, error });
      } else {
        await db.update(whatsappMessages).set({ status: "failed", error }).where(eq(whatsappMessages.id, id));
        logError("whatsapp_failed", { messageId: id, template: m.template, attempts: msg.attempts, error });
        msg.ack();
      }
    } catch (e) {
      logError("whatsapp_deliver_failed", { messageId: id, attempts: msg.attempts, error: String(e) });
      msg.retry({ delaySeconds: backoff(msg.attempts) });
    }
  }
}
