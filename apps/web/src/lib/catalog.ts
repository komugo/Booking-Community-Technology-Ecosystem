import { getActivityPage, getCategoryHub, getCityHub, getHome, type ActivityCard, type Locale, type Slugs } from "@komugo/db";
import { db, showDrafts } from "./db";
import { path, type Alternates } from "./i18n";

type Params = Record<string, string | undefined>;

const query = (locale: Locale) => ({ locale, includeDrafts: showDrafts });
const notFound = () => new Response(null, { status: 404 });

function alternates(l: Locale, search: string, got: (string | undefined)[], parts: Slugs[]): Alternates | Response {
  const alt = { en: path("en", ...parts.map((p) => p.en)), ms: path("ms", ...parts.map((p) => p.ms)) };
  return got.every((g, i) => g === parts[i][l]) ? alt : new Response(null, { status: 301, headers: { Location: alt[l] + search } });
}

export async function loadHome(locale: Locale) {
  return { locale, alternates: { en: path("en"), ms: path("ms") }, ...(await getHome(db, query(locale))) };
}

export async function loadCity(p: Params, locale: Locale, search: string) {
  const data = await getCityHub(db, { ...query(locale), city: p.city! });
  if (!data) return notFound();
  const alt = alternates(locale, search, [p.city], [data.city.slugs]);
  return alt instanceof Response ? alt : { locale, alternates: alt, ...data };
}

export async function loadCategory(p: Params, locale: Locale, search: string) {
  const data = await getCategoryHub(db, { ...query(locale), city: p.city!, category: p.category! });
  if (!data) return notFound();
  const alt = alternates(locale, search, [p.city, p.category], [data.city.slugs, data.category.slugs]);
  return alt instanceof Response ? alt : { locale, alternates: alt, ...data };
}

export async function loadActivity(p: Params, locale: Locale, search: string) {
  const data = await getActivityPage(db, { ...query(locale), city: p.city!, category: p.category!, activity: p.activity! });
  if (!data?.city || !data.category) return notFound();
  const { city, category } = data;
  const alt = alternates(locale, search, [p.city, p.category, p.activity], [city.slugs, category.slugs, data.slugs]);
  if (alt instanceof Response) return alt;
  return { locale, alternates: alt, ...data, city, category, bookable: (data.listingMode === "bookable" || (showDrafts && data.listingMode === "hidden")) && data.options.length > 0 };
}

export type HomeData = Awaited<ReturnType<typeof loadHome>>;
export type CityData = Exclude<Awaited<ReturnType<typeof loadCity>>, Response>;
export type CategoryData = Exclude<Awaited<ReturnType<typeof loadCategory>>, Response>;
export type ActivityData = Exclude<Awaited<ReturnType<typeof loadActivity>>, Response>;

export function categoryFromSen(cards: ActivityCard[], categorySlugEn: string) {
  const inCategory = cards.filter((c) => c.category.en === categorySlugEn);
  const prices = inCategory.flatMap((c) => (c.fromPriceSen === null ? [] : [c.fromPriceSen]));
  return prices.length ? Math.min(...prices) : null;
}
