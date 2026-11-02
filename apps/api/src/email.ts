import { booking, type RefundReason } from "@komugo/booking";
import {
  bills,
  checkouts,
  closureNotices,
  createDb,
  customers,
  packOrders,
  participants,
  projOptions,
  projPackOffers,
  projTimeslots,
  refundEmails,
  type Db,
} from "@komugo/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { klDateTime, klDay, named, optionDetails, rm, type Locale, type OptionDetails } from "./details";
import { log } from "./lib";
import { bookingLink, groupLink } from "./manage";

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
  if (!row?.email || !(row.checkout.bookingId || row.checkout.packId) || row.checkout.emailedAt !== null) return;
  const c = row.checkout;
  const l = c.locale;
  const d = await optionDetails(db, c.optionId, c.timeslotId, []);
  if (!d) return;
  const href = c.bookingId
    ? `${site(env, l)}/bookings/${c.bookingId}?k=${await bookingLink(env, c.bookingId)}`
    : `${site(env, l)}/packs/${c.packId}?k=${await groupLink(env, "pack", c.packId!)}`;
  const { what, when } = summary(d, l);
  const people = c.bookingId
    ? l === "ms"
      ? [`${c.quantity} orang · ${rm(c.amountSen ?? 0)}`]
      : [`${c.quantity} people · ${rm(c.amountSen ?? 0)}`]
    : l === "ms"
      ? [`${c.quantity} orang`]
      : [`${c.quantity} people`];
  const lines =
    l === "ms"
      ? ["Tempahan anda disahkan!", what, when, ...people, "Tunjukkan tiket anda di kaunter semasa tiba."]
      : ["You're booked!", what, when, ...people, "Show your tickets at the counter when you arrive."];
  const label = l === "ms" ? "Lihat tiket" : "View tickets";
  const activity = named(d.activity, l);
  await sendEmail(env, {
    to: row.email,
    subject: c.packId
      ? l === "ms"
        ? `Ditempah dengan Pek anda: ${activity}`
        : `Booked with your Pack: ${activity}`
      : l === "ms"
        ? `Tempahan disahkan: ${activity}`
        : `Booking confirmed: ${activity}`,
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
  const [bill] = await db.select().from(bills).where(eq(bills.id, billId));
  if (!bill?.refundReason || bill.emailedAt !== null) return;
  const amount = rm(bill.paidAmountSen ?? bill.amountSen);
  let mail: { to: string; l: Locale; activity: string; lines: string[]; link?: { href: string; label: string } } | null;
  if (bill.kind === "pack") {
    const [row] = await db
      .select({ order: packOrders, email: customers.email, offer: { nameEn: projPackOffers.nameEn, nameMs: projPackOffers.nameMs } })
      .from(packOrders)
      .innerJoin(customers, eq(customers.id, packOrders.customerId))
      .leftJoin(projPackOffers, eq(projPackOffers.id, packOrders.offerId))
      .where(eq(packOrders.id, bill.checkoutId));
    if (!row?.email) return;
    const l = row.order.locale;
    const offer = row.offer ? named(row.offer, l) : "";
    mail = {
      to: row.email,
      l,
      activity: offer,
      lines:
        l === "ms"
          ? [
              `Kami menerima bayaran ${amount} untuk pembelian Pek anda (${offer}) yang tidak dapat digunakan.`,
              `Bayaran balik penuh ${amount} dalam 7 hari bekerja ke kaedah pembayaran asal anda.`,
            ]
          : [
              `We received a payment of ${amount} for your Pack purchase (${offer}) that we couldn't use.`,
              `Full refund of ${amount} within 7 working days to your original payment method.`,
            ],
    };
  } else {
    const [row] = await db
      .select({ checkout: checkouts, email: customers.email })
      .from(checkouts)
      .innerJoin(customers, eq(customers.id, checkouts.customerId))
      .where(eq(checkouts.id, bill.checkoutId));
    if (!row?.email) return;
    const c = row.checkout;
    const l = c.locale;
    const d = await optionDetails(db, c.optionId, c.timeslotId, []);
    if (!d) return;
    const { what, when } = summary(d, l);
    const gone = bill.refundReason === "unavailable" && !c.bookingId && bill.holdId === c.holdId;
    mail = {
      to: row.email,
      l,
      activity: named(d.activity, l),
      lines:
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
            ],
      link: gone ? { href: `${site(env, l)}/book/${c.optionId}`, label: l === "ms" ? "Tempah masa lain" : "Book another time" } : undefined,
    };
  }
  const { to, l, activity, lines, link } = mail;
  await sendEmail(env, {
    to,
    subject: l === "ms" ? `Bayaran balik: ${activity}` : `Refund on its way: ${activity}`,
    text: [...lines, ...(link ? [`${link.label}: ${link.href}`] : [])].join("\n\n"),
    html: html(lines, link),
    idempotencyKey: `refund:${bill.id}`,
  });
  await db
    .update(bills)
    .set({ emailedAt: Date.now() })
    .where(and(eq(bills.id, bill.id), isNull(bills.emailedAt)));
  log("refund_emailed", { billId: bill.id, checkoutId: bill.checkoutId });
}

export async function sendClosureEmail(env: Env, timeslotId: string, ref: string) {
  const db = createDb(env.DB);
  const match = and(eq(closureNotices.timeslotId, timeslotId), eq(closureNotices.ref, ref));
  const [row] = await db
    .select({ notice: closureNotices, email: customers.email, locale: checkouts.locale, packLocale: packOrders.locale, slot: projTimeslots })
    .from(closureNotices)
    .innerJoin(customers, eq(customers.id, closureNotices.customerId))
    .innerJoin(projTimeslots, eq(projTimeslots.id, closureNotices.timeslotId))
    .leftJoin(checkouts, eq(checkouts.bookingId, closureNotices.bookingId))
    .leftJoin(packOrders, eq(packOrders.packId, closureNotices.packId))
    .where(match);
  if (!row?.email || row.notice.emailedAt !== null) return;
  const { notice: n, slot } = row;
  const l = row.locale ?? row.packLocale ?? "en";
  const d = await optionDetails(db, slot.optionId, timeslotId, []);
  if (!d) return;
  const when = klDateTime(slot.startsAt, l);
  const why = {
    en: {
      weather: " due to the weather",
      maintenance: " for maintenance",
      event: " for an event",
      horse_unfit: " because a horse is unfit to ride",
      other: "",
    },
    ms: {
      weather: " kerana cuaca",
      maintenance: " kerana penyelenggaraan",
      event: " kerana acara",
      horse_unfit: " kerana kuda tidak sihat untuk ditunggang",
      other: "",
    },
  }[l][n.reason];
  const lines =
    l === "ms"
      ? [
          `${d.operatorName} terpaksa menutup ${named(d.option, l)} anda pada ${when}${why}.`,
          n.bookingId
            ? "Anda boleh tukar ke masa lain secara percuma, atau dapatkan bayaran balik penuh. Bayaran balik diterima dalam 7 hari bekerja."
            : "Anda boleh tukar ke masa lain secara percuma, atau dapatkan semula sesi itu dalam Pek anda.",
        ]
      : [
          `${d.operatorName} had to close your ${named(d.option, l)} on ${when}${why}.`,
          n.bookingId
            ? "You can move to another time for free, or get a full refund. Refunds arrive within 7 working days."
            : "You can move to another time for free, or have the session returned to your Pack.",
        ];
  const label = n.bookingId
    ? l === "ms"
      ? "Pilih tukar masa atau bayaran balik"
      : "Choose reschedule or refund"
    : l === "ms"
      ? "Pilih: masa baharu atau sesi dikembalikan"
      : "Choose: new time or session back";
  const href = n.bookingId
    ? `${site(env, l)}/bookings/${n.bookingId}?k=${await bookingLink(env, n.bookingId)}`
    : n.packId
      ? `${site(env, l)}/packs/${n.packId}?k=${await groupLink(env, "pack", n.packId)}`
      : null;
  await sendEmail(env, {
    to: row.email,
    subject: l === "ms" ? `Slot masa ditutup: ${named(d.activity, l)}` : `Timeslot closed: ${named(d.activity, l)}`,
    text: [...lines, ...(href ? [`${label}: ${href}`] : [])].join("\n\n"),
    html: html(lines, href ? { href, label } : undefined),
    idempotencyKey: `closure:${timeslotId}:${ref}`,
  });
  await db
    .update(closureNotices)
    .set({ emailedAt: Date.now() })
    .where(and(match, isNull(closureNotices.emailedAt)));
  log("closure_emailed", { timeslotId, ref });
}

export async function sendPackEmail(env: Env, orderId: string) {
  const db = createDb(env.DB);
  const [row] = await db
    .select({ order: packOrders, email: customers.email, offer: { nameEn: projPackOffers.nameEn, nameMs: projPackOffers.nameMs } })
    .from(packOrders)
    .innerJoin(customers, eq(customers.id, packOrders.customerId))
    .leftJoin(projPackOffers, eq(projPackOffers.id, packOrders.offerId))
    .where(eq(packOrders.id, orderId));
  if (!row?.email || !row.order.packId || row.order.emailedAt !== null) return;
  const { order } = row;
  const l = order.locale;
  const pack = await booking(env, order.operatorId).packView(order.packId!);
  const options = await db
    .select({ nameEn: projOptions.nameEn, nameMs: projOptions.nameMs })
    .from(projOptions)
    .where(inArray(projOptions.id, pack.optionIds.concat("")));
  const offer = row.offer ? named(row.offer, l) : "";
  const names = options.map((o) => named(o, l)).join(", ");
  const until = klDay(pack.expiresAt, l);
  const lines =
    l === "ms"
      ? [
          `${pack.sessionsTotal} sesi · guna sebelum ${until} · untuk ${names}.`,
          "Tempah setiap sesi dalam talian dan pilih 'Guna Pek' semasa pembayaran.",
        ]
      : [
          `${pack.sessionsTotal} sessions · use by ${until} · for ${names}.`,
          "Book each session online and choose 'Use Pack' at payment.",
        ];
  const href = `${site(env, l)}/packs/${order.packId}?k=${await groupLink(env, "pack", order.packId!)}`;
  const label = l === "ms" ? "Tempah sesi" : "Book a session";
  await sendEmail(env, {
    to: row.email,
    subject: l === "ms" ? `Pek anda sedia: ${offer}` : `Your Pack is ready: ${offer}`,
    text: [...lines, `${label}: ${href}`].join("\n\n"),
    html: html(lines, { href, label }),
    idempotencyKey: `pack:${orderId}`,
  });
  await db
    .update(packOrders)
    .set({ emailedAt: Date.now() })
    .where(and(eq(packOrders.id, orderId), isNull(packOrders.emailedAt)));
  log("pack_emailed", { orderId });
}

export type RefundRow = {
  id: string;
  amountSen: number;
  reason: RefundReason;
  operatorId: string;
  customerId: string | null;
  bookingId: string | null;
  billId?: string | null;
};

const emailed = async (db: Db, refundId: string, kind: "due" | "paid") =>
  (await db.select().from(refundEmails).where(and(eq(refundEmails.refundId, refundId), eq(refundEmails.kind, kind)))).length > 0;

async function refundTo(db: Db, r: RefundRow) {
  const [customer] = r.customerId ? await db.select({ email: customers.email }).from(customers).where(eq(customers.id, r.customerId)) : [];
  const [bill] = r.billId ? await db.select({ kind: bills.kind, checkoutId: bills.checkoutId }).from(bills).where(eq(bills.id, r.billId)) : [];
  const [locale] = r.bookingId
    ? await db.select({ l: checkouts.locale }).from(checkouts).where(eq(checkouts.bookingId, r.bookingId))
    : bill?.kind === "pack"
      ? await db.select({ l: packOrders.locale }).from(packOrders).where(eq(packOrders.id, bill.checkoutId))
      : bill
        ? await db.select({ l: checkouts.locale }).from(checkouts).where(eq(checkouts.id, bill.checkoutId))
        : [];
  return { email: customer?.email ?? null, l: locale?.l ?? ("en" as Locale) };
}

// A cancel or Closure Refund; the bill Refunds of step 4 are emailed by sendRefundEmail.
export async function sendRefundDueEmail(env: Env, r: RefundRow) {
  const db = createDb(env.DB);
  if (!r.bookingId || (await emailed(db, r.id, "due"))) return;
  const { email, l } = await refundTo(db, r);
  if (!email) return;
  const v = await booking(env, r.operatorId).bookingView(r.bookingId);
  const tickets = v.tickets.filter((t) => t.refundId === r.id);
  if (!tickets.length) return;
  const [d, people] = await Promise.all([
    optionDetails(db, v.optionId, tickets[0].timeslotId, []),
    db.select({ name: participants.name }).from(participants).where(inArray(participants.id, tickets.map((t) => t.participantId))),
  ]);
  if (!d) return;
  const { what } = summary(d, l);
  const when = klDateTime(tickets[0].startsAt, l);
  const names = people.map((p) => p.name).join(", ");
  const amount = rm(r.amountSen);
  const closed = r.reason === "closure";
  const lines =
    l === "ms"
      ? [
          `Kami telah membatalkan ${names} untuk ${what} (${when})${closed ? ` kerana ${d.operatorName} menutup sesi itu` : ""}. ${amount} akan dikembalikan ke akaun yang anda gunakan untuk membayar dalam 7 hari bekerja.`,
        ]
      : [
          `We cancelled ${names} for ${what} (${when})${closed ? ` because ${d.operatorName} closed the session` : ""}. ${amount} goes back to the account you paid with within 7 working days.`,
        ];
  await sendEmail(env, {
    to: email,
    subject: l === "ms" ? `Bayaran balik sedang diproses: ${amount}` : `Refund on its way: ${amount}`,
    text: lines.join("\n\n"),
    html: html(lines),
    idempotencyKey: `refund-due:${r.id}`,
  });
  await db.insert(refundEmails).values({ refundId: r.id, kind: "due", emailedAt: Date.now() }).onConflictDoNothing();
  log("refund_due_emailed", { refundId: r.id });
}

export async function sendRefundPaidEmail(env: Env, r: RefundRow) {
  const db = createDb(env.DB);
  if (!r.customerId || (await emailed(db, r.id, "paid"))) return;
  const { email, l } = await refundTo(db, r);
  if (!email) return;
  const amount = rm(r.amountSen);
  const lines =
    l === "ms"
      ? [`Kami telah menghantar ${amount} ke akaun yang anda gunakan untuk membayar. Bank mungkin mengambil beberapa hari bekerja untuk memaparkannya.`]
      : [`We've sent ${amount} to the account you paid with. Banks can take a few working days to show it.`];
  await sendEmail(env, {
    to: email,
    subject: l === "ms" ? `Bayaran balik dihantar: ${amount}` : `Refund sent: ${amount}`,
    text: lines.join("\n\n"),
    html: html(lines),
    idempotencyKey: `refund-paid:${r.id}`,
  });
  await db.insert(refundEmails).values({ refundId: r.id, kind: "paid", emailedAt: Date.now() }).onConflictDoNothing();
  log("refund_paid_emailed", { refundId: r.id });
}

const site = (env: Env, l: Locale) => `${env.PUBLIC_SITE_URL}${l === "ms" ? "/ms" : ""}`;

const summary = (d: OptionDetails, l: Locale) => ({
  what: `${named(d.activity, l)} – ${named(d.option, l)}`,
  when: d.slot ? klDateTime(d.slot.startsAt, l) : "",
});
