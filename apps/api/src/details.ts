import { activities, categories, cities, operators, projActivities, projAddOns, projOptions, projTimeslots, type Db } from "@komugo/db";
import { eq, inArray } from "drizzle-orm";

export type Locale = "en" | "ms";

export async function optionDetails(db: Db, optionId: string, timeslotId: string, addOnIds: string[]) {
  // Not db.batch: D1 batch results are keyed by column name, so joined columns that share a name collide.
  const [[row], [slot], addOns] = await Promise.all([
    db
      .select({
        option: projOptions,
        activity: {
          id: activities.id,
          nameEn: activities.nameEn,
          nameMs: activities.nameMs,
          slugEn: activities.slugEn,
          slugMs: activities.slugMs,
          published: activities.published,
          streetAddress: activities.streetAddress,
          postalCode: activities.postalCode,
          lat: activities.lat,
          lng: activities.lng,
          phone: activities.phone,
        },
        city: { slugEn: cities.slugEn, slugMs: cities.slugMs, nameEn: cities.nameEn, nameMs: cities.nameMs },
        category: { slugEn: categories.slugEn, slugMs: categories.slugMs },
        operatorName: operators.name,
        freeCancelHours: projActivities.freeCancelHours,
        bookingCutoffMinutes: projActivities.bookingCutoffMinutes,
        requiresWaiver: projActivities.requiresWaiver,
      })
      .from(projOptions)
      .innerJoin(activities, eq(activities.id, projOptions.activityId))
      .innerJoin(cities, eq(cities.id, activities.cityId))
      .innerJoin(categories, eq(categories.id, activities.categoryId))
      .innerJoin(operators, eq(operators.id, activities.operatorId))
      .leftJoin(projActivities, eq(projActivities.id, activities.id))
      .where(eq(projOptions.id, optionId)),
    db.select().from(projTimeslots).where(eq(projTimeslots.id, timeslotId)),
    db.select().from(projAddOns).where(inArray(projAddOns.id, addOnIds.length ? addOnIds : [""])),
  ]);
  return row ? { ...row, slot, addOns } : null;
}

export type OptionDetails = NonNullable<Awaited<ReturnType<typeof optionDetails>>>;

export const named = (x: { nameEn: string; nameMs: string }, l: Locale) => (l === "ms" ? x.nameMs : x.nameEn);

export const klDateTime = (t: number, l: Locale) =>
  new Intl.DateTimeFormat(l === "ms" ? "ms-MY" : "en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(t);

export const klDay = (t: number, l: Locale) =>
  new Intl.DateTimeFormat(l === "ms" ? "ms-MY" : "en-MY", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium" }).format(t);

export const rm = (sen: number) => `RM ${(sen / 100).toFixed(2)}`;
