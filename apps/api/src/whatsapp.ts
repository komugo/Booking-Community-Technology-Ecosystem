import { createDb, whatsappMessages } from "@komugo/db";
import type { Locale } from "./details";
import { log, logError } from "./lib";

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
} satisfies Record<string, Record<Locale, string>>;

type Template = keyof typeof TEMPLATES;

const render = (t: Template, l: Locale, slots: Record<string, string>) => TEMPLATES[t][l].replace(/\{(\w+)\}/g, (_, k: string) => slots[k]);

// TODO(#22): written before the SendOnTime account and number exist; check the endpoint and payload against SendOnTime's API before going live.
async function sendOnTime(env: Env, m: WhatsApp) {
  const res = await fetch(env.SENDONTIME_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SENDONTIME_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: m.to, message: m.text }),
  });
  if (!res.ok) throw new Error(`sendontime_${res.status}`);
}

async function sendWhatsApp(env: Env, m: WhatsApp) {
  if (env.WHATSAPP_MODE === "log") {
    console.log(JSON.stringify({ event: "dev_whatsapp", to: m.to, text: m.text }));
    devOutbox.unshift({ ...m, at: Date.now() });
    devOutbox.length = Math.min(devOutbox.length, 50);
    return;
  }
  await sendOnTime(env, m);
}

type Contact = { id: string; operatorId: string; phone: string; locale: Locale };

export async function message(env: Env, to: Contact, template: Template, slots: Record<string, string>) {
  const text = render(template, to.locale, slots);
  let error: string | null = null;
  try {
    await sendWhatsApp(env, { to: to.phone, text });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const status = error ? ("failed" as const) : ("sent" as const);
  await createDb(env.DB)
    .insert(whatsappMessages)
    .values({ operatorId: to.operatorId, contactId: to.id, phone: to.phone, template, text, status, error, createdAt: Date.now() });
  (error ? logError : log)(`whatsapp_${status}`, { contactId: to.id, template, ...(error ? { error } : {}) });
  return status;
}
