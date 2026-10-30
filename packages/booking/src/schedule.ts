import { isClosedDay, klDate, klWeekday, type Weekday } from "@komugo/types";

const HORIZON_DAYS = 60;
const DAY = 86_400_000;

const nextDate = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

export function dates(closed: string[], now: number, from = klDate(now), to = klDate(now + HORIZON_DAYS * DAY)) {
  const out: string[] = [];
  for (let d = from > klDate(now) ? from : klDate(now); d <= to; d = nextDate(d)) {
    if (!isClosedDay(d, closed)) out.push(d);
  }
  return out;
}

export function expand(
  r: { weekdays: Weekday[]; times: string[]; startsOn: string; endsOn: string | null },
  closed: string[],
  now: number,
): number[] {
  const horizon = klDate(now + HORIZON_DAYS * DAY);
  const starts: number[] = [];
  for (const d of dates(closed, now, r.startsOn, r.endsOn && r.endsOn < horizon ? r.endsOn : horizon)) {
    if (!r.weekdays.includes(klWeekday(d))) continue;
    for (const hm of r.times) {
      const t = Date.parse(`${d}T${hm}:00+08:00`);
      if (t > now) starts.push(t);
    }
  }
  return starts;
}
