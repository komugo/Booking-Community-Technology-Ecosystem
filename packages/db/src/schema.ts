import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

export const operators = sqliteTable("operators", {
  id: id(),
  name: text().notNull(),
});

const hub = () => ({
  id: id(),
  slugEn: text().notNull().unique(),
  slugMs: text().notNull().unique(),
  nameEn: text().notNull(),
  nameMs: text().notNull(),
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
  },
  (t) => [index("activities_city_category").on(t.cityId, t.categoryId), index("activities_operator").on(t.operatorId)],
);

export const customers = sqliteTable(
  "customers",
  {
    id: id(),
    name: text().notNull(),
    email: text().unique(),
    phone: text().unique(),
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
  },
  (t) => [uniqueIndex("waivers_participant_operator").on(t.participantId, t.operatorId)],
);

export const projActivities = sqliteTable("proj_activities", {
  id: text().primaryKey(),
  operatorId: text().notNull(),
  freeCancelHours: integer().notNull(),
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
    active: integer({ mode: "boolean" }).notNull(),
    version: integer().notNull(),
  },
  (t) => [index("proj_options_activity").on(t.activityId)],
);

// spots is not re-projected when a Timeslot starts: readers must also filter starts_at > now.
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
    version: integer().notNull(),
  },
  (t) => [index("proj_packs_customer").on(t.customerId)],
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
