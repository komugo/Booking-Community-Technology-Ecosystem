// Launch batch: map pins, EN/BM copy and an Illustrative photo for the Activities that go live as Info.
// Pins and hours come from Google Business listings (via OpenSEO); hours only fill what the master list left empty.
import type { Catalogue, Hours, Photo } from "./putrajaya-load";

type UnsplashPhoto = { photoId: string; pageId: string; width: number; height: number; creditName: string; username: string; altEn: string; altMs: string };

export type Launch = {
  venues: Record<string, { lat: number; lng: number; postalCode: string; openingHours?: Hours[] }>;
  activities: Record<string, { descriptionEn: string; descriptionMs: string; photo: string; openingHours?: Hours[] }>;
  photos: Record<string, UnsplashPhoto>;
};

const unsplash = (p: UnsplashPhoto): Photo => ({
  url: `https://images.unsplash.com/photo-${p.photoId}`,
  width: p.width,
  height: p.height,
  altEn: p.altEn,
  altMs: p.altMs,
  creditName: p.creditName,
  creditUrl: `https://unsplash.com/@${p.username}?utm_source=komugo&utm_medium=referral`,
  sourceUrl: `https://unsplash.com/photos/${p.pageId}`,
});

export function launch(data: Catalogue, l: Launch): Catalogue {
  const missing = [
    ...Object.keys(l.venues).filter((id) => !data.venues.some((v) => v.id === id)),
    ...Object.keys(l.activities).filter((id) => !data.activities.some((a) => a.id === id)),
    ...Object.values(l.activities).flatMap((a) => (l.photos[a.photo] ? [] : [`photo ${a.photo}`])),
  ];
  if (missing.length) throw new Error(`Launch file names unknown ${missing.join(", ")}`);
  return {
    ...data,
    venues: data.venues.map((v) => {
      const x = l.venues[v.id];
      if (!x) return v;
      return { ...v, lat: x.lat, lng: x.lng, postalCode: x.postalCode, openingHours: v.openingHours.length ? v.openingHours : (x.openingHours ?? []) };
    }),
    activities: data.activities.map((a) => {
      const x = l.activities[a.id];
      if (!x) return a;
      return {
        ...a,
        listingMode: "info",
        descriptionEn: x.descriptionEn,
        descriptionMs: x.descriptionMs,
        photo: unsplash(l.photos[x.photo]),
        openingHours: a.openingHours.length ? a.openingHours : (x.openingHours ?? []),
      };
    }),
  };
}
