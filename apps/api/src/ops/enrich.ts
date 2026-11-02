import type { CheckInResult, TimeslotRow } from "@komugo/booking";
import { checkouts, closureNotices, createDb, customers, participants, projActivities, projAddOns, projOptions, waivers, within } from "@komugo/db";
import { ageOn, klDate, WAIVER } from "@komugo/types";
import { and, eq } from "drizzle-orm";

export const ticketCode = (id: string) => id.slice(0, 8).toUpperCase();
export const groupRef = (t: { bookingId: string | null; customerId: string; packId: string | null }) =>
  t.bookingId ?? `${t.customerId}:${t.packId}`;

type Lookup = { participantIds: string[]; customerIds?: string[]; bookingIds?: string[]; optionIds?: string[]; addOnIds?: string[] };

async function load(env: Env, operatorId: string, q: Lookup) {
  const db = createDb(env.DB);
  const [people, signed, contacts, buyers, options, addOns] = await Promise.all([
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
      .select({
        id: projOptions.id,
        nameEn: projOptions.nameEn,
        nameMs: projOptions.nameMs,
        durationMinutes: projOptions.durationMinutes,
        requiresWaiver: projActivities.requiresWaiver,
      })
      .from(projOptions)
      .leftJoin(projActivities, eq(projActivities.id, projOptions.activityId))
      .where(within(projOptions.id, q.optionIds ?? [])),
    db
      .select({ id: projAddOns.id, nameEn: projAddOns.nameEn, nameMs: projAddOns.nameMs })
      .from(projAddOns)
      .where(within(projAddOns.id, q.addOnIds ?? [])),
  ]);
  const by = <T, K>(rows: T[], key: (r: T) => K) => new Map(rows.map((r) => [key(r), r]));
  const person = by(people, (p) => p.id);
  const waiver = by(signed, (w) => w.participantId);
  const option = by(options, (o) => o.id);
  return {
    contact: by(contacts, (c) => c.bookingId),
    customer: by(buyers, (c) => c.id),
    addOn: by(addOns, (a) => a.id),
    option: (id: string) => option.get(id) ?? { id, nameEn: "", nameMs: "", durationMinutes: 0, requiresWaiver: true },
    participant(id: string, startsAt: number, optionId: string) {
      const p = person.get(id);
      const w = waiver.get(id);
      const status = !w ? "missing" : w.version !== WAIVER.version ? "outdated" : w.guardian ? "guardian" : "signed";
      const required = option.get(optionId)?.requiresWaiver !== false;
      return {
        participant: { name: p?.name ?? "", age: p ? ageOn(p.birthDate, klDate(startsAt)) : null, weightKg: p?.weightKg ?? null },
        waiver: !required && (status === "missing" || status === "outdated") ? "not_required" : status,
        signerName: w?.signerName ?? null,
      };
    },
  };
}

// A closed Timeslot keeps listing a group after its Customer chose, so the Closure list shows the choice.
export async function enrichTimeslots(env: Env, operatorId: string, rows: TimeslotRow[]) {
  const tickets = rows.flatMap((r) => r.tickets);
  const notices = await createDb(env.DB)
    .select({
      timeslotId: closureNotices.timeslotId,
      ref: closureNotices.ref,
      customerId: closureNotices.customerId,
      bookingId: closureNotices.bookingId,
      packId: closureNotices.packId,
      emailedAt: closureNotices.emailedAt,
      choice: closureNotices.choice,
      chosenAt: closureNotices.chosenAt,
    })
    .from(closureNotices)
    .where(within(closureNotices.timeslotId, rows.map((r) => r.id)));
  const x = await load(env, operatorId, {
    participantIds: tickets.map((t) => t.participantId),
    customerIds: [...tickets, ...notices].map((t) => t.customerId),
    bookingIds: [...tickets, ...notices].flatMap((t) => t.bookingId ?? []),
    optionIds: rows.map((r) => r.optionId),
    addOnIds: rows.flatMap((r) => r.addOns.map((a) => a.addOnId)),
  });
  return rows.map((r) => {
    const groups = new Map<string, { customerId: string; bookingId: string | null; packId: string | null; tickets: typeof r.tickets }>();
    const add = (ref: string, g: { customerId: string; bookingId: string | null; packId: string | null }, t?: (typeof r.tickets)[number]) =>
      groups.set(ref, {
        customerId: g.customerId,
        bookingId: g.bookingId,
        packId: g.packId,
        tickets: [...(groups.get(ref)?.tickets ?? []), ...(t ? [t] : [])],
      });
    for (const t of r.tickets) add(groupRef(t), t, t);
    if (r.closedAt !== null) for (const n of notices) if (n.timeslotId === r.id && !groups.has(n.ref)) add(n.ref, n);
    return {
      id: r.id,
      startsAt: r.startsAt,
      closedAt: r.closedAt,
      closedReason: r.closedReason,
      horse: r.horse,
      spots: r.spots,
      option: x.option(r.optionId),
      groups: [...groups.values()].map(({ bookingId, packId, customerId, tickets: ts }) => {
        const buyer = x.customer.get(customerId);
        const contact = bookingId ? x.contact.get(bookingId) : undefined;
        const notice = notices.find((n) => n.timeslotId === r.id && n.ref === groupRef({ bookingId, packId, customerId }));
        return {
          bookingId,
          packId,
          customerId,
          contact: { name: contact?.name ?? buyer?.name ?? "", phone: contact?.phone ?? buyer?.phone ?? null, email: buyer?.email ?? null },
          addOns: r.addOns
            .filter((a) => a.bookingId === bookingId)
            .map((a) => ({ nameEn: x.addOn.get(a.addOnId)?.nameEn ?? "", nameMs: x.addOn.get(a.addOnId)?.nameMs ?? "", quantity: a.quantity })),
          notice: notice ? { emailedAt: notice.emailedAt, choice: notice.choice, chosenAt: notice.chosenAt } : null,
          tickets: ts.map((t) => ({
            id: t.id,
            code: ticketCode(t.id),
            checkedInAt: t.checkedInAt,
            resources: t.resources,
            ...x.participant(t.participantId, r.startsAt, r.optionId),
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
      ...x.participant(t.participantId, t.startsAt, t.optionId),
    },
  };
}
