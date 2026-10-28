import { activities, closureNotices, createDb, customers, participants, projOptions, projPackOffers, projPacks, projTickets } from "@komugo/db";
import { Hono } from "hono";
import { desc, eq, inArray } from "drizzle-orm";
import { fail } from "./lib";
import { groupLink } from "./manage";
import { groupRef } from "./ops/enrich";
import { readSession } from "./session";

export const me = new Hono<{ Bindings: Env }>();

me.get("/", async (c) => {
  const session = await readSession(c);
  if (!session?.customerId) return fail(c, 401, { code: "signed_out" });
  const customerId = session.customerId;
  const db = createDb(c.env.DB);
  const [[customer], tickets, packs] = await Promise.all([
    db.select({ email: customers.email }).from(customers).where(eq(customers.id, customerId)),
    db.select().from(projTickets).where(eq(projTickets.customerId, customerId)).orderBy(desc(projTickets.startsAt)).limit(200),
    db
      .select({ pack: projPacks, nameEn: projPackOffers.nameEn, nameMs: projPackOffers.nameMs })
      .from(projPacks)
      .leftJoin(projPackOffers, eq(projPackOffers.id, projPacks.offerId))
      .where(eq(projPacks.customerId, customerId))
      .orderBy(desc(projPacks.expiresAt)),
  ]);
  const ids = (xs: string[]) => [...new Set(xs)].concat("");
  const [options, people, notices] = await Promise.all([
    db
      .select({ id: projOptions.id, nameEn: projOptions.nameEn, nameMs: projOptions.nameMs, activity: { nameEn: activities.nameEn, nameMs: activities.nameMs } })
      .from(projOptions)
      .innerJoin(activities, eq(activities.id, projOptions.activityId))
      .where(inArray(projOptions.id, ids(tickets.map((t) => t.optionId)))),
    db.select({ id: participants.id, name: participants.name }).from(participants).where(eq(participants.customerId, customerId)),
    db
      .select({ timeslotId: closureNotices.timeslotId, ref: closureNotices.ref, choice: closureNotices.choice })
      .from(closureNotices)
      .where(eq(closureNotices.customerId, customerId)),
  ]);
  const option = new Map(options.map((o) => [o.id, o]));
  const person = new Map(people.map((p) => [p.id, p.name]));
  const visits = new Map<string, (typeof tickets)[number][]>();
  for (const t of tickets) {
    const key = `${t.bookingId ?? t.packId}|${t.timeslotId}`;
    visits.set(key, [...(visits.get(key) ?? []), t]);
  }
  const now = Date.now();
  const all = await Promise.all(
    [...visits.values()].map(async (ts) => {
      const t = ts[0];
      const kind = t.bookingId ? ("booking" as const) : ("pack" as const);
      const id = (t.bookingId ?? t.packId)!;
      const o = option.get(t.optionId);
      const issued = ts.some((x) => x.status === "issued");
      const choice = notices.find((n) => n.timeslotId === t.timeslotId && n.ref === groupRef(t))?.choice ?? null;
      return {
        kind,
        id,
        k: await groupLink(c.env, kind, id),
        timeslotId: t.timeslotId,
        startsAt: t.startsAt,
        closed: t.closedAt !== null,
        option: { nameEn: o?.nameEn ?? "", nameMs: o?.nameMs ?? "" },
        activity: o?.activity ?? { nameEn: "", nameMs: "" },
        participants: ts.map((x) => person.get(x.participantId) ?? ""),
        statuses: ts.map((x) => x.status),
        section: issued && t.closedAt !== null && !choice ? "awaiting" : issued && t.closedAt === null && t.startsAt > now ? "upcoming" : "past",
      };
    }),
  );
  const section = (s: string) => all.filter((v) => v.section === s).map(({ section: _, ...v }) => v);
  return c.json({
    email: customer?.email ?? null,
    awaiting: section("awaiting").reverse(),
    upcoming: section("upcoming").reverse(),
    packs: await Promise.all(
      packs.map(async ({ pack: p, nameEn, nameMs }) => ({
        id: p.id,
        k: await groupLink(c.env, "pack", p.id),
        nameEn: nameEn ?? "",
        nameMs: nameMs ?? "",
        sessionsTotal: p.sessionsTotal,
        sessionsUsed: p.sessionsUsed,
        expiresAt: p.expiresAt,
        expired: p.expiresAt < now,
      })),
    ),
    past: section("past").slice(0, 20),
  });
});
