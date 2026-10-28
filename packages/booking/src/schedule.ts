import { isClosedDay, klDate, klWeekday, type Weekday } from "@komugo/types";

const HORIZON_DAYS = 60;
const DAY = 86_400_000;

const nextDate = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

export function expand(
  r: { weekdays: Weekday[]; times: string[]; startsOn: string; endsOn: string | null },
  closed: string[],
  now: number,
): number[] {
  const today = klDate(now);
  const horizon = klDate(now + HORIZON_DAYS * DAY);
  const last = r.endsOn && r.endsOn < horizon ? r.endsOn : horizon;
  const starts: number[] = [];
  for (let d = r.startsOn > today ? r.startsOn : today; d <= last; d = nextDate(d)) {
    if (!r.weekdays.includes(klWeekday(d)) || isClosedDay(d, closed)) continue;
    for (const hm of r.times) {
      const t = Date.parse(`${d}T${hm}:00+08:00`);
      if (t > now) starts.push(t);
    }
  }
  return starts;
}
