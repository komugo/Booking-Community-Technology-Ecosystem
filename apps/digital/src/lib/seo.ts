import { company } from "../content/company";
import { href, rm, t, type Fee, type Locale } from "../content/i18n";
import type { Package } from "../content/packages";

type Json = Record<string, unknown>;

export const PROD_HOST = "digital.komugo.com";

export const abs = (site: URL | undefined, p: string) => new URL(p, site).href;

const orgId = (site: URL | undefined) => abs(site, "/#org");

export const orgLd = (site: URL | undefined): Json => ({
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": orgId(site),
  name: company.name,
  legalName: company.legalName || undefined,
  url: abs(site, "/"),
  logo: abs(site, "/logo.svg"),
  email: company.email || undefined,
  telephone: company.whatsapp || undefined,
  parentOrganization: { "@type": "Organization", name: "Komugo", url: company.platformUrl },
});

export const professionalServiceLd = (site: URL | undefined, l: Locale, description: string): Json => ({
  "@context": "https://schema.org",
  "@type": "ProfessionalService",
  "@id": orgId(site),
  name: company.name,
  url: abs(site, href(l)),
  description,
  areaServed: { "@type": "Country", name: "Malaysia" },
  priceRange: "RM1,500–RM150,000+",
  inLanguage: t[l].htmlLang,
});

const offer = (site: URL | undefined, l: Locale, fee: Fee, url: string): Json => ({
  "@type": "Offer",
  priceCurrency: "MYR",
  url: abs(site, url),
  ...(fee.max || fee.from || fee.plus
    ? { priceSpecification: { "@type": "PriceSpecification", priceCurrency: "MYR", minPrice: fee.min, maxPrice: fee.plus ? undefined : fee.max } }
    : { price: fee.min }),
  description: rm(l, fee),
});

export const serviceLd = (site: URL | undefined, l: Locale, s: { name: string; description: string; fee: Fee; url: string }): Json => ({
  "@context": "https://schema.org",
  "@type": "Service",
  name: s.name,
  description: s.description,
  provider: { "@id": orgId(site) },
  areaServed: { "@type": "Country", name: "Malaysia" },
  url: abs(site, s.url),
  offers: offer(site, l, s.fee, s.url),
});

export const packageLd = (site: URL | undefined, l: Locale, p: Package) =>
  serviceLd(site, l, { name: `${p.name[l]}: ${p.title[l]}`, description: p.includes[l].join(", "), fee: p.fee, url: href(l, p.page) });

export const faqLd = (items: { q: string; a: string }[]): Json => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});

export const breadcrumbLd = (site: URL | undefined, items: { name: string; path: string }[]): Json => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: abs(site, it.path) })),
});
