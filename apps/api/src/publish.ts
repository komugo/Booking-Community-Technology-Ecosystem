export type Gap = "venue" | "mapPin" | "descriptionEn" | "descriptionMs" | "photo";

// What an Activity still lacks to leave Hidden. Category is required by the schema.
export function publishGaps(
  a: { descriptionEn: string; descriptionMs: string; photos: number },
  venue: { lat: number | null; lng: number | null } | null,
): Gap[] {
  const gaps: [boolean, Gap][] = [
    [!venue, "venue"],
    [!!venue && (venue.lat === null || venue.lng === null), "mapPin"],
    [!a.descriptionEn.trim(), "descriptionEn"],
    [!a.descriptionMs.trim(), "descriptionMs"],
    [a.photos === 0, "photo"],
  ];
  return gaps.filter(([missing]) => missing).map(([, g]) => g);
}
