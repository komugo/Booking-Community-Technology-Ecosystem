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

type Sender = { send(m: WhatsApp): Promise<void>; connected(): Promise<boolean> };

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
};

// TODO(#22): written before the SendOnTime account and number exist; check both endpoints and payloads against SendOnTime's API before going live.
// Until SENDONTIME_DEVICE_URL is set the device counts as linked, so only failed sends reach the banner.
const sendOnTime = (env: Env): Sender => ({
  async send(m) {
    const res = await fetch(env.SENDONTIME_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.SENDONTIME_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: m.to, message: m.text }),
    });
    if (!res.ok) throw new Error(`sendontime_${res.status}`);
  },
  async connected() {
    if (!env.SENDONTIME_DEVICE_URL) return true;
    try {
      const res = await fetch(env.SENDONTIME_DEVICE_URL, { headers: { Authorization: `Bearer ${env.SENDONTIME_API_KEY}` } });
      return res.ok && ((await res.json()) as { connected?: unknown }).connected === true;
    } catch {
      return false;
    }
  },
});

export const sender = (env: Env) => (env.WHATSAPP_MODE === "log" ? logSender : sendOnTime(env));

async function attempt(env: Env, to: string, text: string) {
  try {
    await sender(env).send({ to, text });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// Only the newest Welcome per contact is theirs; old Digests (their close links are gone) never; every other message counts for a day. A removed contact's message is shown but never resent.
export const current = sql`case when ${whatsappMessages.template} = 'welcome' then not exists (select 1 from whatsapp_messages n where n.contact_id = ${whatsappMessages.contactId} and n.template = 'welcome' and n.created_at > ${whatsappMessages.createdAt}) when ${whatsappMessages.template} = 'digest' then 0 else ${whatsappMessages.createdAt} > unixepoch() * 1000 - ${24 * HOUR} end`;
const live = sql`exists (select 1 from operator_contacts c where c.id = ${whatsappMessages.contactId})`;

type Contact = { id: string; operatorId: string; phone: string; locale: Locale };

export const message = (env: Env, to: Contact, template: Template, slots: Record<string, string>) =>
  send(env, to, template, render(template, to.locale, slots));

export async function send(env: Env, to: Contact, template: Template | "staff", text: string) {
  const error = await attempt(env, to.phone, text);
  const status = error ? ("failed" as const) : ("sent" as const);
  await createDb(env.DB)
    .insert(whatsappMessages)
    .values({ operatorId: to.operatorId, contactId: to.id, phone: to.phone, template, text, status, error, createdAt: Date.now() });
  (error ? logError : log)(`whatsapp_${status}`, { contactId: to.id, template, ...(error ? { error } : {}) });
  return status;
}

// Resends a failed message as it was first written, to the number it went to. Claiming the row first stops two staff sending it twice.
export async function retry(env: Env, id: string) {
  const db = createDb(env.DB);
  const [m] = await db
    .update(whatsappMessages)
    .set({ status: "sent", error: null })
    .where(and(eq(whatsappMessages.id, id), eq(whatsappMessages.status, "failed"), current, live))
    .returning();
  if (!m) return null;
  const error = await attempt(env, m.phone, m.text);
  if (error) await db.update(whatsappMessages).set({ status: "failed", error }).where(eq(whatsappMessages.id, id));
  const status = error ? ("failed" as const) : ("sent" as const);
  (error ? logError : log)(`whatsapp_retry_${status}`, { messageId: id, ...(error ? { error } : {}) });
  return status;
}
