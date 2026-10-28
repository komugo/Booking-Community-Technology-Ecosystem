import { klDate } from "./i18n";

const DAY = 86_400_000;

// 60 KL days from today with the slots of the picked (or first open) date.
export function daysAndTimes<T extends { startsAt: number }>(slots: T[], picked: string, now = Date.now()) {
  const byDate = new Map<string, T[]>();
  for (const x of slots) byDate.set(klDate(x.startsAt), [...(byDate.get(klDate(x.startsAt)) ?? []), x]);
  const today = klDate(now);
  const days = Array.from({ length: 60 }, (_, i) => {
    const at = Date.parse(`${today}T04:00:00Z`) + i * DAY;
    const d = klDate(at);
    return { date: d, at, open: byDate.has(d) };
  });
  const firstOpen = days.find((d) => d.open)?.date ?? null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(picked) && days.some((d) => d.date === picked) ? picked : (firstOpen ?? today);
  const times = byDate.get(date) ?? [];
  const nextOpen = times.length ? null : (days.find((d) => d.open && d.date > date) ?? null);
  return { days, date, times, nextOpen };
}

export type Days = ReturnType<typeof daysAndTimes>["days"];
