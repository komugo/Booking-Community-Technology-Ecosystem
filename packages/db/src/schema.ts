import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Weekday } from "@komugo/types";

export type { Weekday };
export type OpeningHours = { days: Weekday[]; opens: string; closes: string };
export type Faq = { q: string; a: string };

const json = <T>() => text({ mode: "json" }).$type<T>().notNull().default(sql`'[]'`);

const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

export const operators = sqliteTable("operators", {
  id: id(),
  name: text().notNull(),
  commissionBps: integer(),
});

const hub = () => ({
  id: id(),
  slugEn: text().notNull().unique(),
  slugMs: text().notNull().unique(),
  nameEn: text().notNull(),
  nameMs: text().notNull(),
  introEn: text().notNull().default(""),
  introMs: text().notNull().default(""),
  photoId: text(),
});
export const cities = sqliteTable("cities", hub());
export const categories = sqliteTable("categories", hub());

export const activities = sqliteTable(
  "activities",
  {
    id: id(),
    operatorId: text()
      .notNull()
      .references(() => operators.id),
    cityId: text()
      .notNull()
      .references(() => cities.id),
    categoryId: text()
      .notNull()
      .references(() => categories.id),
    slugEn: text().notNull().unique(),
    slugMs: text().notNull().unique(),
    nameEn: text().notNull(),
    nameMs: text().notNull(),
    descriptionEn: text().notNull(),
    descriptionMs: text().notNull(),
    published: integer({ mode: "boolean" }).notNull().default(false),
    streetAddress: text(),
    postalCode: text(),
    phone: text(),
    lat: real(),
    lng: real(),
    openingHours: json<OpeningHours[]>(),
    hoursNoteEn: text(),
    hoursNoteMs: text(),
    highlightsEn: json<string[]>(),
    highlightsMs: json<string[]>(),
    faqEn: json<Faq[]>(),
    faqMs: json<Faq[]>(),
  },
  (t) => [index("activities_city_category").on(t.cityId, t.categoryId), index("activities_operator").on(t.operatorId)],
);

export const photos = sqliteTable(
  "photos",
  {
    id: id(),
    activityId: text().references(() => activities.id),
    position: integer().notNull().default(0),
    url: text().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    altEn: text().notNull(),
    altMs: text().notNull(),
    creditName: text().notNull(),
    creditUrl: text().notNull(),
    sourceUrl: text().notNull(),
  },
  (t) => [index("photos_activity_position").on(t.activityId, t.position)],
);

export const customers = sqliteTable(
  "customers",
  {
    id: id(),
    name: text().notNull(),
    email: text().unique(),
    phone: text().unique(),
    emailVerifiedAt: integer(),
    createdAt: integer(),
  },
  (t) => [check("customers_contact", sql`${t.email} is not null or ${t.phone} is not null`)],
);

export const participants = sqliteTable(
  "participants",
  {
    id: id(),
    customerId: text()
      .notNull()
      .references(() => customers.id),
    name: text().notNull(),
    birthDate: text().notNull(),
    weightKg: integer(),
    certs: text({ mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  },
  (t) => [
    index("participants_customer").on(t.customerId),
    check("participants_birth_date", sql`${t.birthDate} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
    check("participants_weight_kg", sql`${t.weightKg} > 0`),
  ],
);

export const waivers = sqliteTable(
  "waivers",
  {
    id: id(),
    participantId: text()
      .notNull()
      .references(() => participants.id),
    operatorId: text()
      .notNull()
      .references(() => operators.id),
    signerName: text().notNull(),
    signedAt: integer()
      .notNull()
      .$defaultFn(() => Date.now()),
    version: text(),
    locale: text(),
    // CHECK (guardian IN (0,1)) is added by hand in 0002_checkout: a drizzle table check would rebuild the table.
    guardian: integer({ mode: "boolean" }).notNull().default(false),
    signerCustomerId: text(),
    textSha256: text(),
  },
  (t) => [uniqueIndex("waivers_participant_operator").on(t.participantId, t.operatorId)],
);

export const projActivities = sqliteTable("proj_activities", {
  id: text().primaryKey(),
  operatorId: text().notNull(),
  freeCancelHours: integer().notNull(),
  bookingCutoffMinutes: integer().notNull().default(60),
  version: integer().notNull(),
});

export const projOptions = sqliteTable(
  "proj_options",
  {
    id: text().primaryKey(),
    operatorId: text().notNull(),
    activityId: text().notNull(),
    nameEn: text().notNull(),
    nameMs: text().notNull(),
    priceSen: integer().notNull(),
    durationMinutes: integer().notNull(),
    minAge: integer(),
    maxAge: integer(),
    maxWeightKg: integer(),
    requiredCert: text(),
    minParticipants: integer(),
    active: integer({ mode: "boolean" }).notNull(),
    asksWeight: integer({ mode: "boolean" }).notNull().default(false),
    version: integer().notNull(),
  },
  (t) => [index("proj_options_activity").on(t.activityId)],
);

export const projAddOns = sqliteTable(
  "proj_add_ons",
  {
    id: text().primaryKey(),
    operatorId: text().notNull(),
    activityId: text().notNull(),
    nameEn: text().notNull(),
    nameMs: text().notNull(),
    priceSen: integer().notNull(),
    active: integer({ mode: "boolean" }).notNull(),
    version: integer().notNull(),
  },
  (t) => [index("proj_add_ons_activity").on(t.activityId)],
);

// spots is not re-projected as time passes: readers must also filter starts_at - booking_cutoff_minutes > now.
export const projTimeslots = sqliteTable(
  "proj_timeslots",
  {
    id: text().primaryKey(),
    operatorId: text().notNull(),
    optionId: text().notNull(),
    startsAt: integer().notNull(),
    closedAt: integer(),
    spots: integer().notNull(),
    version: integer().notNull(),
  },
  (t) => [index("proj_timeslots_option_starts").on(t.optionId, t.startsAt), index("proj_timeslots_starts").on(t.startsAt)],
);

export const projTickets = sqliteTable(
  "proj_tickets",
  {
    id: text().primaryKey(),
    operatorId: text().notNull(),
    customerId: text().notNull(),
    participantId: text().notNull(),
    bookingId: text(),
    packId: text(),
    optionId: text().notNull(),
    timeslotId: text().notNull(),
    startsAt: integer().notNull(),
    closedAt: integer(),
    priceSen: integer().notNull(),
    commissionBps: integer(),
    status: text({ enum: ["issued", "cancelled", "forfeited"] }).notNull(),
    version: integer().notNull(),
  },
  (t) => [index("proj_tickets_customer_starts").on(t.customerId, t.startsAt), index("proj_tickets_operator_starts").on(t.operatorId, t.startsAt)],
);

export const projPacks = sqliteTable(
  "proj_packs",
  {
    id: text().primaryKey(),
    operatorId: text().notNull(),
    customerId: text().notNull(),
    sessionsTotal: integer().notNull(),
    sessionsUsed: integer().notNull(),
    expiresAt: integer().notNull(),
    offerId: text(),
    optionIds: json<string[]>(),
    priceSen: integer(),
    commissionBps: integer(),
    createdAt: integer(),
    version: integer().notNull(),
  },
  (t) => [index("proj_packs_customer").on(t.customerId)],
);

export const projPackOffers = sqliteTable(
  "proj_pack_offers",
  {
    id: text().primaryKey(),
    operatorId: text().notNull(),
    activityId: text().notNull(),
    nameEn: text().notNull(),
    nameMs: text().notNull(),
    sessions: integer().notNull(),
    priceSen: integer().notNull(),
    validDays: integer().notNull(),
    optionIds: json<string[]>(),
    active: integer({ mode: "boolean" }).notNull(),
    version: integer().notNull(),
  },
  (t) => [index("proj_pack_offers_activity").on(t.activityId)],
);

export const projRefunds = sqliteTable(
  "proj_refunds",
  {
    id: text().primaryKey(),
    operatorId: text().notNull(),
    customerId: text(),
    billId: text(),
    bookingId: text(),
    amountSen: integer().notNull(),
    reason: text({ enum: ["duplicate", "amount_mismatch", "unavailable", "unknown_hold", "cancel", "closure"] }).notNull(),
    createdAt: integer().notNull(),
    refundedAt: integer(),
    version: integer().notNull(),
  },
  (t) => [index("proj_refunds_refunded_created").on(t.refundedAt, t.createdAt), index("proj_refunds_operator").on(t.operatorId)],
);

export const projPayments = sqliteTable(
  "proj_payments",
  {
    billId: text().primaryKey(),
    operatorId: text().notNull(),
    holdId: text().notNull(),
    bookingId: text(),
    amountSen: integer().notNull(),
    status: text({ enum: ["paid", "refund_due"] }).notNull(),
    refundReason: text({ enum: ["duplicate", "amount_mismatch", "unavailable", "unknown_hold"] }),
    receivedAt: integer().notNull(),
    version: integer().notNull(),
  },
  (t) => [index("proj_payments_operator").on(t.operatorId), index("proj_payments_status").on(t.status)],
);

export type AddOnPick = { id: string; qty: number; priceSen?: number };
export type DraftParticipant = {
  name: string;
  birthDate: string;
  weightKg: number | null;
  certs: string[];
  waiver: { guardian: boolean; signerName: string; textSha256: string; signedAt: number } | null;
};

export const sessions = sqliteTable(
  "sessions",
  {
    idHash: text().primaryKey(),
    customerId: text().references(() => customers.id),
    createdAt: integer().notNull(),
    expiresAt: integer().notNull(),
  },
  (t) => [index("sessions_customer").on(t.customerId)],
);

export const otps = sqliteTable(
  "otps",
  {
    id: id(),
    email: text().notNull(),
    checkoutId: text(),
    ip: text(),
    codeHash: text().notNull(),
    attempts: integer().notNull().default(0),
    createdAt: integer().notNull(),
    expiresAt: integer().notNull(),
    usedAt: integer(),
  },
  (t) => [index("otps_email_created").on(t.email, t.createdAt)],
);

export const checkouts = sqliteTable(
  "checkouts",
  {
    id: id(),
    sessionId: text().notNull(),
    customerId: text().references(() => customers.id),
    operatorId: text().notNull(),
    activityId: text().notNull(),
    optionId: text().notNull(),
    timeslotId: text().notNull(),
    quantity: integer().notNull(),
    addOns: json<AddOnPick[]>(),
    draft: text({ mode: "json" }).$type<DraftParticipant[]>(),
    participantIds: text({ mode: "json" }).$type<string[]>(),
    contactName: text(),
    contactEmail: text(),
    contactPhone: text(),
    locale: text({ enum: ["en", "ms"] }).notNull(),
    holdId: text(),
    holdSeq: integer().notNull().default(0),
    holdExpiresAt: integer(),
    amountSen: integer(),
    bookingId: text().unique(),
    packId: text(),
    refundReason: text(),
    emailedAt: integer(),
    createdAt: integer().notNull(),
    updatedAt: integer().notNull(),
  },
  (t) => [
    index("checkouts_session").on(t.sessionId),
    index("checkouts_customer").on(t.customerId),
    index("checkouts_hold").on(t.holdId),
  ],
);

export const bills = sqliteTable(
  "bills",
  {
    id: text().primaryKey(),
    checkoutId: text().notNull(),
    holdId: text().notNull().unique(),
    amountSen: integer().notNull(),
    url: text().notNull(),
    createdAt: integer().notNull(),
    paidAt: integer(),
    deletedAt: integer(),
    paidAmountSen: integer(),
    refundReason: text(),
    emailedAt: integer(),
    // A Pack bill's checkoutId and holdId are both its pack_orders id.
    kind: text({ enum: ["booking", "pack"] }).notNull().default("booking"),
  },
  (t) => [index("bills_paid_created").on(t.paidAt, t.createdAt)],
);

export const packOrders = sqliteTable(
  "pack_orders",
  {
    id: text().primaryKey(),
    customerId: text()
      .notNull()
      .references(() => customers.id),
    operatorId: text().notNull(),
    offerId: text().notNull(),
    amountSen: integer().notNull(),
    locale: text({ enum: ["en", "ms"] }).notNull(),
    packId: text().unique(),
    emailedAt: integer(),
    createdAt: integer().notNull(),
  },
  (t) => [index("pack_orders_customer_offer").on(t.customerId, t.offerId, t.createdAt)],
);

export const members = sqliteTable(
  "members",
  {
    id: id(),
    email: text().notNull().unique(),
    name: text().notNull(),
    role: text({ enum: ["staff", "operator"] }).notNull(),
    operatorId: text().references(() => operators.id),
    createdAt: integer()
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [
    check("members_scope", sql`(${t.role} = 'staff') = (${t.operatorId} is null)`),
    index("members_operator").on(t.operatorId),
  ],
);

export const memberSessions = sqliteTable(
  "member_sessions",
  {
    idHash: text().primaryKey(),
    memberId: text()
      .notNull()
      .references(() => members.id),
    createdAt: integer().notNull(),
    expiresAt: integer().notNull(),
  },
);

export const closureNotices = sqliteTable(
  "closure_notices",
  {
    timeslotId: text().notNull(),
    ref: text().notNull(),
    customerId: text()
      .notNull()
      .references(() => customers.id),
    bookingId: text(),
    packId: text(),
    reason: text({ enum: ["weather", "horse_unfit", "other"] }).notNull(),
    createdAt: integer().notNull(),
    emailedAt: integer(),
    choice: text({ enum: ["refund", "reschedule"] }),
    chosenAt: integer(),
  },
  (t) => [primaryKey({ columns: [t.timeslotId, t.ref] }), index("closure_notices_unsent").on(t.emailedAt, t.createdAt)],
);

export const payouts = sqliteTable(
  "payouts",
  {
    operatorId: text()
      .notNull()
      .references(() => operators.id),
    month: text().notNull(),
    amountSen: integer().notNull(),
    paidAt: integer().notNull(),
    paidBy: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.operatorId, t.month] }), index("payouts_paid_at").on(t.paidAt)],
);

export const refundEmails = sqliteTable(
  "refund_emails",
  {
    refundId: text().notNull(),
    kind: text({ enum: ["due", "paid"] }).notNull(),
    emailedAt: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.refundId, t.kind] })],
);
