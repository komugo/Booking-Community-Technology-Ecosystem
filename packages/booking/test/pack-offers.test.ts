import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { rid, rideWorld } from "./helpers";

test("a Pack offer takes only its own Activity's Options and can't move to another Activity", async () => {
  const w = await rideWorld();
  const otherActivity = rid();
  await w.b.upsertActivity({ id: otherActivity, freeCancelHours: 24 });
  const foreign = await w.option({ activityId: otherActivity });
  await expect(w.offer({ optionIds: [w.optionId, foreign] })).rejects.toMatchObject({ code: "invalid_state" });
  await expect(w.offer({ optionIds: [] })).rejects.toMatchObject({ code: "invalid_state" });
  await expect(
    w.sql(
      `INSERT INTO pack_offers (id, activity_id, name_en, name_ms, sessions, price_sen, valid_days, option_ids)
       VALUES (?, ?, 'x', 'x', 1, 100, 1, '[]')`,
      rid(),
      w.activityId,
    ),
  ).rejects.toThrow(/CHECK/);
  const offer = await w.offer({ optionIds: [w.optionId, w.optionId] });
  await expect(w.b.upsertPackOffer({ ...offer, activityId: otherActivity, optionIds: [foreign] })).rejects.toMatchObject({
    code: "invalid_state",
  });
  expect((await w.b.setup()).packOffers).toEqual([{ ...offer, optionIds: [w.optionId] }]);
});

test("a Pack offer and its edits are projected to proj_pack_offers", async () => {
  const w = await rideWorld();
  const offer = await w.offer({ optionIds: [w.optionId] });
  await w.b.upsertPackOffer({ ...offer, priceSen: 30000, active: false });
  await w.flush();
  expect(await env.DB.prepare("SELECT * FROM proj_pack_offers WHERE id = ?").bind(offer.id).all()).toMatchObject({
    results: [
      {
        operator_id: w.operatorId,
        activity_id: w.activityId,
        name_en: "4 rides",
        name_ms: "4 tunggangan",
        sessions: 4,
        price_sen: 30000,
        valid_days: 30,
        option_ids: JSON.stringify([w.optionId]),
        active: 0,
      },
    ],
  });
});
