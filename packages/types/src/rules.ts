const KL_OFFSET = 8 * 3_600_000;

export const klDate = (t: number) => new Date(t + KL_OFFSET).toISOString().slice(0, 10);

export function ageOn(birthDate: string, date: string) {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = date.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export const participantKey = (name: string, birthDate: string) => `${name.trim().toLowerCase()}|${birthDate}`;
