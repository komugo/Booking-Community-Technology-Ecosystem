import type { CheckInResult, TimeslotRow } from "@komugo/booking";
import { checkouts, closureNotices, createDb, customers, participants, projAddOns, projOptions, waivers } from "@komugo/db";
import { ageOn, klDate, WAIVER } from "@komugo/types";
import { and, eq, sql, type Column } from "drizzle-orm";

// json_each keeps it to one bound parameter; D1 caps a statement at 100.
const within = (col: Column, ids: string[]) => sql`${col} IN (SELECT value FROM json_each(${JSON.stringify([...new Set(ids)])}))`;

export const ticketCode = (id: string) => id.slice(0, 8).toUpperCase();
export const groupRef = (t: { bookingId: string | null; customerId: string; packId: string | null }) =>
  t.bookingId ?? `${t.customerId}:${t.packId}`;

type Lookup = { participantIds: string[]; customerIds?: string[]; bookingIds?: string[]; optionIds?: string[]; addOnIds?: string[]; timeslotIds?: string[] };

async function load(env: Env, operatorId: string, q: Lookup) {
  const db = createDb(env.DB);
  const [people, signed, contacts, buyers, options, addOns, notices] = await Promise.all([
    db
      .select({ id: participants.id, name: participants.name, birthDate: participants.birthDate, weightKg: participants.weightKg })
      .from(participants)
      .where(within(participants.id, q.participantIds)),
    db
      .select({ participantId: waivers.participantId, version: waivers.version, guardian: waivers.guardian, signerName: waivers.signerName })
      .from(waivers)
      .where(and(eq(waivers.operatorId, operatorId), within(waivers.participantId, q.participantIds))),
    db
      .select({ bookingId: checkouts.bookingId, name: checkouts.contactName, phone: checkouts.contactPhone })
      .from(checkouts)
      .where(within(checkouts.bookingId, q.bookingIds ?? [])),
    db
      .select({ id: customers.id, name: customers.name, email: customers.email, phone: customers.phone })
      .from(customers)
      .where(within(customers.id, q.customerIds ?? [])),
    db
      .select({ id: projOptions.id, nameEn: projOptions.nameEn, nameMs: projOptions.nameMs, durationMinutes: projOptions.durationMinutes })
      .from(projOptions)
      .where(within(projOptions.id, q.optionIds ?? [])),
    db
      .select({ id: projAddOns.id, nameEn: projAddOns.nameEn, nameMs: projAddOns.nameMs })
      .from(projAddOns)
      .where(within(projAddOns.id, q.addOnIds ?? [])),
    db
      .select({ timeslotId: closureNotices.timeslotId, ref: closureNotices.ref, emailedAt: closureNotices.emailedAt })
      .from(closureNotices)
      .where(within(closureNotices.timeslotId, q.timeslotIds ?? [])),
  ]);
  const by = <T, K>(rows: T[], key: (r: T) => K) => new Map(rows.map((r) => [key(r), r]));
  const person = by(people, (p) => p.id);
  const waiver = by(signed, (w) => w.participantId);
  const option = by(options, (o) => o.id);
  return {
    contact: by(contacts, (c) => c.bookingId),
    customer: by(buyers, (c) => c.id),
    addOn: by(addOns, (a) => a.id),
    notices,
    option: (id: string) => option.get(id) ?? { id, nameEn: "", nameMs: "", durationMinutes: 0 },
    participant(id: string, startsAt: number) {
      const p = person.get(id);
      const w = waiver.get(id);
      return {
        participant: { name: p?.name ?? "", age: p ? ageOn(p.birthDate, klDate(startsAt)) : null, weightKg: p?.weightKg ?? null },
        waiver: !w ? "missing" : w.version !== WAIVER.version ? "outdated" : w.guardian ? "guardian" : "signed",
        signerName: w?.signerName ?? null,
      };
    },
  };
}

export async function enrichTimeslots(env: Env, operatorId: string, rows: TimeslotRow[]) {
  const tickets = rows.flatMap((r) => r.tickets);
  const x = await load(env, operatorId, {
    participantIds: tickets.map((t) => t.participantId),
    customerIds: tickets.map((t) => t.customerId),
    bookingIds: tickets.flatMap((t) => t.bookingId ?? []),
    optionIds: rows.map((r) => r.optionId),
    addOnIds: rows.flatMap((r) => r.addOns.map((a) => a.addOnId)),
    timeslotIds: rows.map((r) => r.id),
  });
  return rows.map((r) => {
    const groups = new Map<string, typeof r.tickets>();
    for (const t of r.tickets) groups.set(groupRef(t), [...(groups.get(groupRef(t)) ?? []), t]);
    return {
      id: r.id,
      startsAt: r.startsAt,
      closedAt: r.closedAt,
      closedReason: r.closedReason,
      spots: r.spots,
      option: x.option(r.optionId),
      groups: [...groups.values()].map((ts) => {
        const { bookingId, packId, customerId } = ts[0];
        const buyer = x.customer.get(customerId);
        const contact = bookingId ? x.contact.get(bookingId) : undefined;
        const notice = x.notices.find((n) => n.timeslotId === r.id && n.ref === groupRef(ts[0]));
        return {
          bookingId,
          packId,
          customerId,
          contact: { name: contact?.name ?? buyer?.name ?? "", phone: contact?.phone ?? buyer?.phone ?? null, email: buyer?.email ?? null },
          addOns: r.addOns
            .filter((a) => a.bookingId === bookingId)
            .map((a) => ({ nameEn: x.addOn.get(a.addOnId)?.nameEn ?? "", nameMs: x.addOn.get(a.addOnId)?.nameMs ?? "", quantity: a.quantity })),
          notice: notice ? { emailedAt: notice.emailedAt } : null,
          tickets: ts.map((t) => ({
            id: t.id,
            code: ticketCode(t.id),
            checkedInAt: t.checkedInAt,
            resources: t.resources,
            ...x.participant(t.participantId, r.startsAt),
          })),
        };
      }),
    };
  });
}

export async function enrichCheckIn(env: Env, operatorId: string, r: CheckInResult) {
  if (!r.ticket) return { outcome: r.outcome, ticket: null };
  const t = r.ticket;
  const x = await load(env, operatorId, { participantIds: [t.participantId], optionIds: [t.optionId] });
  const { nameEn, nameMs } = x.option(t.optionId);
  return {
    outcome: r.outcome,
    ticket: {
      id: t.id,
      code: ticketCode(t.id),
      bookingId: t.bookingId,
      timeslotId: t.timeslotId,
      startsAt: t.startsAt,
      checkedInAt: t.checkedInAt,
      option: { nameEn, nameMs },
      ...x.participant(t.participantId, t.startsAt),
    },
  };
}
