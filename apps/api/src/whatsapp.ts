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
      "Every night at 9pm we send the Digest: tomorrow's Tickets with time, court, Customer name and Ticket code. If a Ticket is booked, cancelled or moved after that, we send a Booking alert straight away.",
      "Our messages have links to open today's list or close a time, with no sign-in.",
    ].join("\n\n"),
    ms: [
      "Salam {contact}, ini Komugo. Kami akan menghantar tempahan {operator} ke nombor ini. Sila simpan nombor ini dan balas \"OK\" supaya mesej kami sampai kepada anda.",
      "Setiap malam jam 9 kami hantar Digest: tiket esok dengan masa, gelanggang, nama pelanggan dan kod tiket. Jika tiket ditempah, dibatalkan atau dipindahkan selepas itu, kami terus hantar makluman tempahan.",
      "Mesej kami ada pautan untuk buka senarai hari ini atau tutup sesuatu masa, tanpa log masuk.",
    ].join("\n\n"),
  },
  digest: {
    en: "{operator}: Tickets for tomorrow, {date}\n\n{tickets}\n\nToday's list, always up to date (works until the day ends): {link}",
    ms: "{operator}: Tiket untuk esok, {date}\n\n{tickets}\n\nSenarai hari ini, sentiasa terkini (sah sehingga hari tamat): {link}",
  },
  alert: {
    en: "{operator}: Booking alert for {date}\n\n{change}\n\nToday's list, always up to date: {link}",
    ms: "{operator}: Makluman tempahan untuk {date}\n\n{change}\n\nSenarai hari ini, sentiasa terkini: {link}",
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

// Only the newest message per contact and template is theirs, and a Digest only until its day starts (3h after 9pm KL); each Booking alert, Closure done and Payout notice counts for a day. A removed contact's message is shown but never resent.
export const current = sql`case when ${whatsappMessages.template} in ('alert', 'closure', 'payout') then ${whatsappMessages.createdAt} > unixepoch() * 1000 - ${24 * HOUR} else not exists (select 1 from whatsapp_messages n where n.contact_id = ${whatsappMessages.contactId} and n.template = ${whatsappMessages.template} and n.created_at > ${whatsappMessages.createdAt}) and (${whatsappMessages.template} != 'digest' or ${whatsappMessages.createdAt} > unixepoch() * 1000 - ${3 * HOUR}) end`;
const live = sql`exists (select 1 from operator_contacts c where c.id = ${whatsappMessages.contactId})`;

type Contact = { id: string; operatorId: string; phone: string; locale: Locale };

export async function message(env: Env, to: Contact, template: Template, slots: Record<string, string>) {
  const text = render(template, to.locale, slots);
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
