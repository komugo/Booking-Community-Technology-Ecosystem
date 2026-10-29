import type { ActivityCard, Locale } from "@komugo/db";
import type { ActivityData } from "./catalog";
import { path, t, WEEKDAYS } from "./i18n";
import { src } from "./photo";

type Json = Record<string, unknown>;

const SITE_NAME = "Komugo";
const DAY_URL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => `https://schema.org/${d}`);

export const abs = (site: URL | undefined, p: string) => new URL(p, site).href;

export const cardPath = (l: Locale, c: ActivityCard) => path(l, c.city[l], c.category[l], c.slugs[l]);

export const homeLd = (site: URL | undefined, l: Locale): Json[] => [
  { "@context": "https://schema.org", "@type": "Organization", name: SITE_NAME, url: abs(site, "/"), logo: abs(site, "/logo.svg") },
  { "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: abs(site, path(l)), inLanguage: t[l].htmlLang },
];

export const breadcrumbLd = (site: URL | undefined, items: { name: string; path: string }[]): Json => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: abs(site, it.path) })),
});

export function itemListLd(site: URL | undefined, l: Locale, cards: ActivityCard[]): Json[] {
  const items = cards.filter((c) => c.published).map((c, i) => ({ "@type": "ListItem", position: i + 1, url: abs(site, cardPath(l, c)) }));
  return items.length ? [{ "@context": "https://schema.org", "@type": "ItemList", itemListElement: items }] : [];
}

export function activityLd(site: URL | undefined, l: Locale, a: ActivityData): Json[] {
  const url = abs(site, path(l, a.city.slugs[l], a.category.slugs[l], a.slugs[l]));
  const images = a.photos.map((p) => src(p, 1440, "jpg"));
  const venue: Json = {
    "@context": "https://schema.org",
    "@type": "SportsActivityLocation",
    name: a.name,
    url,
    image: images,
    telephone: a.phone ?? undefined,
    address: {
      "@type": "PostalAddress",
      streetAddress: a.streetAddress ?? undefined,
      postalCode: a.postalCode ?? undefined,
      addressLocality: a.city.name,
      addressCountry: "MY",
    },
    geo: a.lat !== null && a.lng !== null ? { "@type": "GeoCoordinates", latitude: a.lat, longitude: a.lng } : undefined,
    openingHoursSpecification: a.openingHours.map((h) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: h.days.map((d) => DAY_URL[WEEKDAYS.indexOf(d)]),
      opens: h.opens,
      closes: h.closes,
    })),
  };
  const products = a.options.map((o) => ({
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${a.name}: ${o.name}`,
    image: images[0],
    brand: { "@type": "Brand", name: a.operatorName },
    offers: {
      "@type": "Offer",
      price: (o.fromPriceSen / 100).toFixed(2),
      priceCurrency: "MYR",
      url,
    },
  }));
  const faq = a.faq.length
    ? [
        {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: a.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
        },
      ]
    : [];
  return [venue, ...products, ...faq];
}
