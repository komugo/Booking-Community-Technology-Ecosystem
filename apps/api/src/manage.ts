import { booking, BookingError, type BookingView, type Group, type PackView } from "@komugo/booking";
import {
  checkouts,
  closureNotices,
  createDb,
  packOrders,
  participants,
  projActivities,
  projOptions,
  projPackOffers,
  projTimeslots,
} from "@komugo/db";
import { Hono } from "hono";
import { and, asc, eq, gt, gte, inArray, isNull, lt, ne } from "drizzle-orm";
import { optionDetails } from "./details";
import { sendRefundDueEmail } from "./email";
import { b64url, DAY, fail, hmac, HOUR, limited, logError, MIN, requireJson, safeEqual, UUID, type Ctx } from "./lib";
import { groupRef } from "./ops/enrich";
import { owns, readSession } from "./session";

type Kind = "booking" | "pack";

export const groupLink = async (env: Env, kind: Kind, id: string) =>
  b64url(new Uint8Array(await hmac(env.APP_SECRET, `${kind === "booking" ? "link" : "pack"}:${id}`)).slice(0, 16));

export const bookingLink = (env: Env, bookingId: string) => groupLink(env, "booking", bookingId);

// A signed-in owner may change anything; the emailed link k may only view and make the Closure choice.
async function access(c: Ctx, kind: Kind, id: string, k: unknown) {
  const db = createDb(c.env.DB);
  const [g] =
    kind === "booking"
      ? await db
          .select({ operatorId: checkouts.operatorId, customerId: checkouts.customerId, sessionId: checkouts.sessionId })
          .from(checkouts)
          .where(eq(checkouts.bookingId, id))
      : await db
          .select({ operatorId: packOrders.operatorId, customerId: packOrders.customerId })
          .from(packOrders)
          .where(eq(packOrders.packId, id));
  if (!g?.customerId) return null;
  const session = await readSession(c);
  const viaSession =
    !!session && (session.customerId === g.customerId || ("sessionId" in g && owns(session, { sessionId: g.sessionId, customerId: g.customerId })));
  const viaLink = typeof k === "string" && safeEqual(k, await groupLink(c.env, kind, id));
  if (!viaSession && !viaLink) return null;
  const group: Group = kind === "booking" ? { bookingId: id } : { packId: id };
  return {
    ...g,
    customerId: g.customerId,
    session,
    viaSession,
    group,
    ref: groupRef({ bookingId: kind === "booking" ? id : null, packId: kind === "pack" ? id : null, customerId: g.customerId }),
    b: booking(c.env, g.operatorId),
  };
}
type Access = NonNullable<Awaited<ReturnType<typeof access>>>;

const view = (a: Access): Promise<BookingView | PackView> =>
  "bookingId" in a.group ? a.b.bookingView(a.group.bookingId) : a.b.packView(a.group.packId);

// t is "closed:<timeslotId>" (the Closure choice) or a comma list of Ticket ids.
function pick(tickets: BookingView["tickets"], t: string | undefined) {
  if (t?.startsWith("closed:")) return tickets.filter((x) => x.status === "issued" && x.closedAt !== null && x.timeslotId === t.slice(7));
  const want = new Set((t ?? "").split(",").filter(Boolean));
  return tickets.filter((x) => want.has(x.id));
}

export function manage(kind: Kind) {
  const app = new Hono<{ Bindings: Env }>();

  app.onError((e, c) => {
    if (e instanceof BookingError) return fail(c, 409, { code: e.code });
    throw e;
  });

  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const a = await access(c, kind, id, c.req.query("k"));
    if (!a) return fail(c, 404, { code: "not_found" });
    const db = createDb(c.env.DB);
    const v = await view(a);
    const optionId = "optionId" in v ? v.optionId : (v.tickets[0]?.optionId ?? v.optionIds[0] ?? "");
    const addOns = "addOns" in v ? v.addOns : [];
    const [d, people, closure, offer, options] = await Promise.all([
      optionDetails(
        db,
        optionId,
        v.tickets[0]?.timeslotId ?? "",
        addOns.map((x) => x.addOnId),
      ),
      db
        .select({ id: participants.id, name: participants.name })
        .from(participants)
        .where(inArray(participants.id, v.tickets.map((t) => t.participantId).concat(""))),
      db
        .select({ timeslotId: closureNotices.timeslotId, reason: closureNotices.reason })
        .from(closureNotices)
        .where(eq(closureNotices.ref, a.ref)),
      "offerId" in v && v.offerId
        ? db.select({ id: projPackOffers.id, nameEn: projPackOffers.nameEn, nameMs: projPackOffers.nameMs }).from(projPackOffers).where(eq(projPackOffers.id, v.offerId))
        : [],
      "optionIds" in v
        ? db.select({ id: projOptions.id, nameEn: projOptions.nameEn, nameMs: projOptions.nameMs }).from(projOptions).where(inArray(projOptions.id, v.optionIds.concat("")))
        : [],
    ]);
    if (!d) return fail(c, 404, { code: "not_found" });
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    const addOnOf = new Map(d.addOns.map((x) => [x.id, x]));
    const choiceOf = new Map(v.closureChoices.map((x) => [x.timeslotId, x]));
    return c.json({
      kind,
      id,
      option: { id: d.option.id, nameEn: d.option.nameEn, nameMs: d.option.nameMs, durationMinutes: d.option.durationMinutes },
      activity: { ...d.activity, city: d.city, category: d.category },
      operatorName: d.operatorName,
      freeCancelHours: v.freeCancelHours,
      tickets: v.tickets.map((t) => ({ ...t, participantName: nameOf.get(t.participantId) ?? "" })),
      addOns: addOns.map((x) => ({ ...x, nameEn: addOnOf.get(x.addOnId)?.nameEn ?? "", nameMs: addOnOf.get(x.addOnId)?.nameMs ?? "" })),
      closure: closure.map((n) => ({ ...n, choice: choiceOf.get(n.timeslotId)?.choice ?? null, chosenAt: choiceOf.get(n.timeslotId)?.chosenAt ?? null })),
      canChange: a.viaSession,
      k: await groupLink(c.env, kind, id),
      ...("amountSen" in v
        ? { amountSen: v.amountSen }
        : { offer: offer[0] ?? null, sessionsTotal: v.sessionsTotal, sessionsUsed: v.sessionsUsed, expiresAt: v.expiresAt, options }),
    });
  });

  app.get("/:id/quote", async (c) => {
    const a = await access(c, kind, c.req.param("id"), c.req.query("k"));
    if (!a) return fail(c, 404, { code: "not_found" });
    const tickets = pick((await view(a)).tickets, c.req.query("t"));
    if (!tickets.length) return fail(c, 409, { code: "invalid_state" });
    if (!a.viaSession && tickets.some((t) => t.closedAt === null)) return fail(c, 401, { code: "sign_in_required" });
    return c.json(
      await a.b.cancelQuote({ customerId: a.customerId, group: a.group, ticketIds: tickets.map((t) => t.id), onlyClosed: !a.viaSession }),
    );
  });

  app.get("/:id/slots", async (c) => {
    const a = await access(c, kind, c.req.param("id"), c.req.query("k"));
    if (!a) return fail(c, 404, { code: "not_found" });
    const v = await view(a);
    const tickets = pick(v.tickets, c.req.query("t"));
    if (!tickets.length) return fail(c, 409, { code: "invalid_state" });
    const now = Date.now();
    const closed = tickets[0].closedAt !== null;
    if (!closed && tickets.some((t) => t.startsAt <= now)) return fail(c, 409, { code: "started" });
    if (!closed && !(v.freeCancelHours && now <= tickets[0].startsAt - v.freeCancelHours * HOUR)) {
      return fail(c, 409, { code: "window_passed" });
    }
    const db = createDb(c.env.DB);
    const [cutoff] = await db
      .select({ minutes: projActivities.bookingCutoffMinutes })
      .from(projOptions)
      .innerJoin(projActivities, eq(projActivities.id, projOptions.activityId))
      .where(eq(projOptions.id, tickets[0].optionId));
    const last = "expiresAt" in v && !closed ? Math.min(v.expiresAt + 1, now + 60 * DAY) : now + 60 * DAY;
    const slots = await db
      .select({ id: projTimeslots.id, startsAt: projTimeslots.startsAt, spots: projTimeslots.spots })
      .from(projTimeslots)
      .where(
        and(
          eq(projTimeslots.optionId, tickets[0].optionId),
          isNull(projTimeslots.closedAt),
          gte(projTimeslots.spots, tickets.length),
          gt(projTimeslots.startsAt, now + (cutoff?.minutes ?? 0) * MIN),
          lt(projTimeslots.startsAt, last),
          ne(projTimeslots.id, tickets[0].timeslotId),
        ),
      )
      .orderBy(asc(projTimeslots.startsAt));
    return c.json({ ticketIds: tickets.map((t) => t.id), slots });
  });

  async function change(c: Ctx) {
    const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
    const id = c.req.param("id")!;
    const a = await access(c, kind, id, body.k);
    if (!a) return { res: fail(c, 404, { code: "not_found" }) };
    if (await limited(c.env.RL_CHECKOUT, a.session?.idHash ?? `k:${id}`)) return { res: fail(c, 429, { code: "rate_limited" }) };
    if (typeof body.requestId !== "string" || !UUID.test(body.requestId)) {
      return { res: fail(c, 400, { code: "invalid_field", field: "requestId" }) };
    }
    const tickets = pick((await view(a)).tickets, typeof body.t === "string" ? body.t : undefined);
    if (!tickets.length) return { res: fail(c, 409, { code: "invalid_state" }) };
    if (!a.viaSession && tickets.some((t) => t.closedAt === null)) return { res: fail(c, 401, { code: "sign_in_required" }) };
    return { a, body, requestId: body.requestId, tickets };
  }

  app.post("/:id/cancel", requireJson, async (c) => {
    const x = await change(c);
    if ("res" in x) return x.res;
    const { a, body, tickets } = x;
    const r = await a.b.cancelTickets({
      requestId: x.requestId,
      customerId: a.customerId,
      group: a.group,
      ticketIds: tickets.map((t) => t.id),
      onlyClosed: !a.viaSession,
      expectSen: Number(body.expectSen),
      expectForfeited: Array.isArray(body.expectForfeited) ? body.expectForfeited.map(String) : [],
    });
    if (r.refund && "bookingId" in a.group) {
      const refund = { ...r.refund, operatorId: a.operatorId, customerId: a.customerId, bookingId: a.group.bookingId };
      c.executionCtx.waitUntil(
        sendRefundDueEmail(c.env, refund).catch((e) => logError("refund_due_email_failed", { refundId: refund.id, error: String(e) })),
      );
    }
    return c.json(r);
  });

  app.post("/:id/reschedule", requireJson, async (c) => {
    const x = await change(c);
    if ("res" in x) return x.res;
    const { a, body, tickets } = x;
    return c.json(
      await a.b.rescheduleTickets({
        requestId: x.requestId,
        customerId: a.customerId,
        group: a.group,
        ticketIds: tickets.map((t) => t.id),
        timeslotId: String(body.timeslotId ?? ""),
        participantIds: tickets.map((t) => t.participantId),
        onlyClosed: !a.viaSession,
      }),
    );
  });

  return app;
}
