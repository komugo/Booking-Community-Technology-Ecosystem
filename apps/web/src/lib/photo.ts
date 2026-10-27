import type { Photo } from "@komugo/db";

const WIDTHS = [480, 768, 1080, 1440, 1920];

export const src = (p: Photo, w: number, fm?: "jpg") => `${p.url}?w=${w}&q=60&fit=crop&${fm ? `fm=${fm}` : "auto=format"}`;

export const srcset = (p: Photo) =>
  WIDTHS.filter((w) => w <= p.width)
    .map((w) => `${src(p, w)} ${w}w`)
    .join(", ");

// Hub heroes are object-cover in a tall box, so on narrow screens the image is wider than the viewport.
export const heroSizes = (p: Photo) => {
  const r = p.width / p.height;
  return `(max-width: 767px) ${Math.max(100, Math.ceil(152 * r))}vw, (max-width: 1279px) ${Math.max(100, Math.ceil(92 * r))}vw, 100vw`;
};

export const ogImage = (p: Photo) => `${p.url}?w=1200&h=630&fit=crop&q=70&fm=jpg`;

export const homeHero = (alt: string): Photo => ({
  url: "https://images.unsplash.com/photo-1546700990-7b6416f2d90c",
  width: 3264,
  height: 4928,
  alt,
  creditName: "Amir Kh",
  creditUrl: "https://unsplash.com/@amirkhajouie?utm_source=komugo&utm_medium=referral",
  sourceUrl: "https://unsplash.com/photos/jnRiKEyMWcw",
});
