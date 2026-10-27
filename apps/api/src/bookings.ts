import { booking } from "@komugo/booking";
import { checkouts, createDb, participants } from "@komugo/db";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { optionDetails } from "./details";
import { b64url, fail, hmac, safeEqual } from "./lib";
import { owns, readSession } from "./session";

export const bookingLink = async (env: Env, bookingId: string) =>
  b64url(new Uint8Array(await hmac(env.APP_SECRET, `link:${bookingId}`)).slice(0, 16));

export const bookings = new Hono<{ Bindings: Env }>();

bookings.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const [checkout] = await db.select().from(checkouts).where(eq(checkouts.bookingId, id));
  const k = c.req.query("k");
  const allowed =
    checkout && (owns(await readSession(c), checkout) || (!!k && safeEqual(k, await bookingLink(c.env, id))));
  if (!allowed) return fail(c, 404, { code: "not_found" });

  const view = await booking(c.env, checkout.operatorId).bookingView(id);
  const [d, people] = await Promise.all([
    optionDetails(
      db,
      view.optionId,
      view.timeslotId,
      view.addOns.map((a) => a.addOnId),
    ),
    db
      .select({ id: participants.id, name: participants.name })
      .from(participants)
      .where(inArray(participants.id, view.tickets.map((t) => t.participantId))),
  ]);
  if (!d) return fail(c, 404, { code: "not_found" });
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const addOnOf = new Map(d.addOns.map((a) => [a.id, a]));
  return c.json({
    bookingId: id,
    checkoutId: checkout.id,
    locale: checkout.locale,
    startsAt: view.startsAt,
    amountSen: view.amountSen,
    option: {
      id: d.option.id,
      nameEn: d.option.nameEn,
      nameMs: d.option.nameMs,
      durationMinutes: d.option.durationMinutes,
    },
    activity: { ...d.activity, city: d.city, category: d.category },
    operatorName: d.operatorName,
    freeCancelHours: d.freeCancelHours,
    tickets: view.tickets.map((t) => ({ ...t, participantName: nameOf.get(t.participantId) ?? "" })),
    addOns: view.addOns.map((a) => ({
      ...a,
      nameEn: addOnOf.get(a.addOnId)?.nameEn ?? "",
      nameMs: addOnOf.get(a.addOnId)?.nameMs ?? "",
    })),
  });
});
