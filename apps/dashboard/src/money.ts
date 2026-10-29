export const rm = (sen: number) => `RM${sen % 100 ? (sen / 100).toFixed(2) : sen / 100}`;
// An unparseable value is sent as typed so the API rejects it on the right field.
export const sen = (s: string) => (s.trim() === "" ? null : Number.isFinite(Number(s)) ? Math.round(Number(s) * 100) : s);
