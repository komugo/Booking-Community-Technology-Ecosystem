import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tstzrange = customType<{ data: string }>({ dataType: () => "tstzrange" });
const id = () => uuid().primaryKey().defaultRandom();
const ts = () => timestamp({ withTimezone: true });

export const resourceKind = pgEnum("resource_kind", ["horse", "instructor", "belayer", "auto_belay_lane"]);
export const ticketStatus = pgEnum("ticket_status", ["issued", "cancelled", "forfeited"]);

export const operators = pgTable("operators", {
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
export const cities = pgTable("cities", hub());
export const categories = pgTable("categories", hub());

export const activities = pgTable(
  "activities",
  {
    id: id(),
    operatorId: uuid().notNull().references(() => operators.id),
    cityId: uuid().notNull().references(() => cities.id),
    categoryId: uuid().notNull().references(() => categories.id),
    slugEn: text().notNull().unique(),
    slugMs: text().notNull().unique(),
    nameEn: text().notNull(),
    nameMs: text().notNull(),
    descriptionEn: text().notNull(),
    descriptionMs: text().notNull(),
    freeCancelHours: integer().notNull(),
  },
  (t) => [
    index().on(t.cityId, t.categoryId),
    check("activities_free_cancel_hours", sql`${t.freeCancelHours} >= 0`),
  ],
);

export const options = pgTable(
  "options",
  {
    id: id(),
    activityId: uuid().notNull().references(() => activities.id),
    nameEn: text().notNull(),
    nameMs: text().notNull(),
    priceSen: integer().notNull(),
    durationMinutes: integer().notNull(),
    minAge: integer(),
    maxAge: integer(),
    maxWeightKg: integer(),
    requiredCert: text(),
  },
  (t) => [
    index().on(t.activityId),
    check("options_price_sen", sql`${t.priceSen} >= 0`),
    check("options_duration_minutes", sql`${t.durationMinutes} > 0`),
    check("options_age_range", sql`${t.minAge} <= ${t.maxAge}`),
  ],
);

export const resources = pgTable(
  "resources",
  {
    id: id(),
    operatorId: uuid().notNull().references(() => operators.id),
    kind: resourceKind().notNull(),
    name: text().notNull(),
    active: boolean().notNull().default(true),
    maxSessionsPerDay: integer(),
    restMinutes: integer().notNull().default(0),
    maxRiderWeightKg: integer(),
  },
  (t) => [
    index().on(t.operatorId, t.kind),
    check("resources_max_sessions_per_day", sql`${t.maxSessionsPerDay} > 0`),
    check("resources_rest_minutes", sql`${t.restMinutes} >= 0`),
    check("resources_max_rider_weight_kg", sql`${t.maxRiderWeightKg} > 0`),
    check(
      "resources_welfare_rules_horse_only",
      sql`${t.kind} = 'horse' or (${t.maxSessionsPerDay} is null and ${t.restMinutes} = 0 and ${t.maxRiderWeightKg} is null)`,
    ),
  ],
);

export const optionResources = pgTable(
  "option_resources",
  {
    optionId: uuid()
      .notNull()
      .references(() => options.id, { onDelete: "cascade" }),
    kind: resourceKind().notNull(),
    quantity: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.optionId, t.kind] }), check("option_resources_quantity", sql`${t.quantity} > 0`)],
);

export const timeslots = pgTable(
  "timeslots",
  {
    id: id(),
    optionId: uuid().notNull().references(() => options.id),
    startsAt: ts().notNull(),
    closedAt: ts(),
  },
  (t) => [uniqueIndex().on(t.optionId, t.startsAt)],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    name: text().notNull(),
    email: text().unique(),
    phone: text().unique(),
  },
  (t) => [check("customers_contact", sql`${t.email} is not null or ${t.phone} is not null`)],
);

export const participants = pgTable(
  "participants",
  {
    id: id(),
    customerId: uuid().notNull().references(() => customers.id),
    name: text().notNull(),
    birthDate: date().notNull(),
    weightKg: integer(),
    certs: text().array().notNull().default(sql`'{}'`),
  },
  (t) => [index().on(t.customerId)],
);

export const waivers = pgTable(
  "waivers",
  {
    id: id(),
    participantId: uuid().notNull().references(() => participants.id),
    operatorId: uuid().notNull().references(() => operators.id),
    signerName: text().notNull(),
    signedAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.participantId, t.operatorId)],
);

export const holds = pgTable(
  "holds",
  {
    id: id(),
    customerId: uuid().notNull().references(() => customers.id),
    timeslotId: uuid().notNull().references(() => timeslots.id),
    priceSen: integer().notNull(),
    expiresAt: ts().notNull().default(sql`now() + interval '15 minutes'`),
  },
  (t) => [index().on(t.expiresAt), index().on(t.timeslotId)],
);

export const bookings = pgTable("bookings", {
  id: id(),
  customerId: uuid().notNull().references(() => customers.id),
  holdId: uuid().notNull().unique(),
  createdAt: ts().notNull().defaultNow(),
});

export const packs = pgTable(
  "packs",
  {
    id: id(),
    customerId: uuid().notNull().references(() => customers.id),
    operatorId: uuid().notNull().references(() => operators.id),
    sessionsTotal: integer().notNull(),
    expiresAt: ts().notNull(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [check("packs_sessions_total", sql`${t.sessionsTotal} > 0`)],
);

export const tickets = pgTable(
  "tickets",
  {
    id: id(),
    bookingId: uuid().references(() => bookings.id),
    packId: uuid().references(() => packs.id),
    participantId: uuid().notNull().references(() => participants.id),
    timeslotId: uuid().notNull().references(() => timeslots.id),
    priceSen: integer().notNull(),
    status: ticketStatus().notNull().default("issued"),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index().on(t.timeslotId),
    index().on(t.bookingId),
    index().on(t.packId),
    uniqueIndex("tickets_one_issued_per_participant_timeslot")
      .on(t.participantId, t.timeslotId)
      .where(sql`${t.status} = 'issued'`),
    check("tickets_price_sen", sql`${t.priceSen} >= 0`),
    check("tickets_booking_or_pack", sql`num_nonnulls(${t.bookingId}, ${t.packId}) = 1`),
  ],
);

// EXCLUDE (resource_id WITH =, block WITH &&) lives in a custom migration; drizzle-kit cannot express it.
export const allocations = pgTable(
  "allocations",
  {
    id: id(),
    resourceId: uuid().notNull().references(() => resources.id),
    holdId: uuid().references(() => holds.id, { onDelete: "cascade" }),
    ticketId: uuid().references(() => tickets.id),
    participantId: uuid().notNull().references(() => participants.id),
    block: tstzrange().notNull(),
  },
  (t) => [
    index().on(t.holdId),
    index().on(t.ticketId),
    check("allocations_hold_or_ticket", sql`num_nonnulls(${t.holdId}, ${t.ticketId}) = 1`),
  ],
);
