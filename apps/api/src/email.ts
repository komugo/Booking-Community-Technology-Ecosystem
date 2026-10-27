import { bills, checkouts, createDb, customers } from "@komugo/db";
import { and, eq, isNull } from "drizzle-orm";
import { bookingLink } from "./bookings";
import { klDateTime, named, optionDetails, rm, type Locale, type OptionDetails } from "./details";
import { log } from "./lib";

export type Email = { to: string; subject: string; text: string; html: string; idempotencyKey?: string };

export const devInbox: (Email & { at: number })[] = [];

export async function sendEmail(env: Env, e: Email) {
  if (env.EMAIL_MODE === "log") {
    console.log(JSON.stringify({ event: "dev_email", to: e.to, subject: e.subject, text: e.text }));
    devInbox.unshift({ ...e, at: Date.now() });
    devInbox.length = Math.min(devInbox.length, 50);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      ...(e.idempotencyKey ? { "Idempotency-Key": e.idempotencyKey } : {}),
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [e.to], subject: e.subject, text: e.text, html: e.html }),
  });
  if (!res.ok) throw new Error(`resend_${res.status}`);
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const html = (lines: string[], link?: { href: string; label: string }) =>
  `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#111">${lines
    .map((l) => `<p>${esc(l)}</p>`)
    .join("")}${
    link
      ? `<p><a href="${esc(link.href)}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;border-radius:8px;text-decoration:none">${esc(link.label)}</a></p>`
      : ""
  }</div>`;

export function otpEmail(to: string, code: string, l: Locale): Email {
  const lines =
    l === "ms"
      ? [`Kod pengesahan Komugo anda ialah ${code}.`, "Kod ini tamat dalam 10 minit. Jika anda tidak memintanya, abaikan e-mel ini."]
      : [`Your Komugo verification code is ${code}.`, "It expires in 10 minutes. If you didn't ask for it, ignore this email."];
  return {
    to,
    subject: l === "ms" ? `Kod Komugo anda: ${code}` : `Your Komugo code: ${code}`,
    text: lines.join("\n\n"),
    html: html(lines),
  };
}

export async function sendBookedEmail(env: Env, checkoutId: string) {
  const db = createDb(env.DB);
  const [row] = await db
    .select({ checkout: checkouts, email: customers.email })
    .from(checkouts)
    .innerJoin(customers, eq(customers.id, checkouts.customerId))
    .where(eq(checkouts.id, checkoutId));
  if (!row?.email || !row.checkout.bookingId || row.checkout.emailedAt !== null) return;
  const c = row.checkout;
  const l = c.locale;
  const d = await optionDetails(db, c.optionId, c.timeslotId, []);
  if (!d) return;
  const href = `${site(env, l)}/bookings/${c.bookingId}?k=${await bookingLink(env, c.bookingId!)}`;
  const { what, when } = summary(d, l);
  const lines =
    l === "ms"
      ? ["Tempahan anda disahkan!", what, when, `${c.quantity} orang · ${rm(c.amountSen ?? 0)}`, "Tunjukkan tiket anda di kaunter semasa tiba."]
      : ["You're booked!", what, when, `${c.quantity} people · ${rm(c.amountSen ?? 0)}`, "Show your tickets at the counter when you arrive."];
  const label = l === "ms" ? "Lihat tiket" : "View tickets";
  await sendEmail(env, {
    to: row.email,
    subject: l === "ms" ? `Tempahan disahkan: ${named(d.activity, l)}` : `Booking confirmed: ${named(d.activity, l)}`,
    text: [...lines, `${label}: ${href}`].join("\n\n"),
    html: html(lines, { href, label }),
    idempotencyKey: `booked:${c.id}`,
  });
  await db
    .update(checkouts)
    .set({ emailedAt: Date.now() })
    .where(and(eq(checkouts.id, c.id), isNull(checkouts.emailedAt)));
  log("checkout_emailed", { checkoutId: c.id, kind: "booked" });
}

export async function sendRefundEmail(env: Env, billId: string) {
  const db = createDb(env.DB);
  const [row] = await db
    .select({ bill: bills, checkout: checkouts, email: customers.email })
    .from(bills)
    .innerJoin(checkouts, eq(checkouts.id, bills.checkoutId))
    .innerJoin(customers, eq(customers.id, checkouts.customerId))
    .where(eq(bills.id, billId));
  if (!row?.email || !row.bill.refundReason || row.bill.emailedAt !== null) return;
  const { bill, checkout: c } = row;
  const l = c.locale;
  const d = await optionDetails(db, c.optionId, c.timeslotId, []);
  if (!d) return;
  const { what, when } = summary(d, l);
  const amount = rm(bill.paidAmountSen ?? bill.amountSen);
  const gone = bill.refundReason === "unavailable" && !c.bookingId && bill.holdId === c.holdId;
  const lines =
    l === "ms"
      ? [
          gone
            ? `Bayaran anda untuk ${what} (${when}) diterima, tetapi masa itu tidak lagi tersedia.`
            : `Kami menerima bayaran ${amount} untuk ${what} (${when}) yang tidak dapat digunakan untuk tempahan ini.`,
          `Bayaran balik penuh ${amount} dalam 7 hari bekerja ke kaedah pembayaran asal anda.`,
          ...(gone ? ["Anda boleh menempah masa lain."] : []),
        ]
      : [
          gone
            ? `We received your payment for ${what} (${when}), but that time is no longer available.`
            : `We received a payment of ${amount} for ${what} (${when}) that we couldn't use for this booking.`,
          `Full refund of ${amount} within 7 working days to your original payment method.`,
          ...(gone ? ["You can book another time."] : []),
        ];
  const href = `${site(env, l)}/book/${c.optionId}`;
  const label = l === "ms" ? "Tempah masa lain" : "Book another time";
  await sendEmail(env, {
    to: row.email,
    subject: l === "ms" ? `Bayaran balik: ${named(d.activity, l)}` : `Refund on its way: ${named(d.activity, l)}`,
    text: [...lines, ...(gone ? [`${label}: ${href}`] : [])].join("\n\n"),
    html: html(lines, gone ? { href, label } : undefined),
    idempotencyKey: `refund:${bill.id}`,
  });
  await db
    .update(bills)
    .set({ emailedAt: Date.now() })
    .where(and(eq(bills.id, bill.id), isNull(bills.emailedAt)));
  log("refund_emailed", { billId: bill.id, checkoutId: c.id });
}

const site = (env: Env, l: Locale) => `${env.PUBLIC_SITE_URL}${l === "ms" ? "/ms" : ""}`;

const summary = (d: OptionDetails, l: Locale) => ({
  what: `${named(d.activity, l)} – ${named(d.option, l)}`,
  when: d.slot ? klDateTime(d.slot.startsAt, l) : "",
});
