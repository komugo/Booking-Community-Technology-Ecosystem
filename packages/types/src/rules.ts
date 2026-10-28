const KL_OFFSET = 8 * 3_600_000;

export const klDate = (t: number) => new Date(t + KL_OFFSET).toISOString().slice(0, 10);

export function ageOn(birthDate: string, date: string) {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = date.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export const participantKey = (name: string, birthDate: string) => `${name.trim().toLowerCase()}|${birthDate}`;

export type Weekday = "Mo" | "Tu" | "We" | "Th" | "Fr" | "Sa" | "Su";
export const WEEKDAYS: Weekday[] = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
export const CLOSED_DAY = /^(Mo|Tu|We|Th|Fr|Sa|Su)(#[1-5])?$/;
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const klWeekday = (date: string): Weekday => WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];

export function isClosedDay(date: string, closed: string[]) {
  const wd = klWeekday(date);
  return closed.includes(wd) || closed.includes(`${wd}#${Math.ceil(Number(date.slice(8)) / 7)}`);
}
