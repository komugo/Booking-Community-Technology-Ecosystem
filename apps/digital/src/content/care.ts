import type { Fee, List, Text } from "./i18n";

export type CarePlan = { id: "essential" | "business" | "professional" | "enterprise"; name: Text; fee: Fee; changes: number | null; extras: List };

export const carePlans: CarePlan[] = [
  { id: "essential", name: { en: "Essential Care", ms: "Essential Care" }, fee: { min: 99 }, changes: 2, extras: { en: [], ms: [] } },
  {
    id: "business",
    name: { en: "Business Care", ms: "Business Care" },
    fee: { min: 199 },
    changes: 5,
    extras: { en: ["Quarterly security check"], ms: ["Semakan keselamatan setiap suku tahun"] },
  },
  {
    id: "professional",
    name: { en: "Professional Care", ms: "Professional Care" },
    fee: { min: 399 },
    changes: 10,
    extras: { en: ["Priority in our queue", "Monthly analytics report"], ms: ["Keutamaan dalam giliran kerja", "Laporan analitik bulanan"] },
  },
  {
    id: "enterprise",
    name: { en: "Enterprise SLA", ms: "Enterprise SLA" },
    fee: { min: 1000, from: true },
    changes: null,
    extras: { en: ["Scope and service levels agreed in contract"], ms: ["Skop dan tahap perkhidmatan dipersetujui dalam kontrak"] },
  },
];

export const changesLabel: Record<"en" | "ms", (n: number) => string> = {
  en: (n) => `${n} Content changes a month`,
  ms: (n) => `${n} Perubahan kandungan sebulan`,
};

export const contentChange: Text = {
  en: "A Content change is one edit to text, images or prices on an existing page, taking at most 30 minutes. Unused changes don't roll over.",
  ms: "Satu Perubahan kandungan ialah satu suntingan pada teks, gambar atau harga di halaman sedia ada, tidak melebihi 30 minit. Baki yang tidak digunakan tidak dibawa ke bulan berikutnya.",
};

export const careNote: Text = {
  en: "Care plans are optional and billed monthly on top of Hosting. New pages, major features and development are quoted separately.",
  ms: "Care plan adalah pilihan dan dibayar bulanan di atas Hosting. Halaman baharu, ciri utama dan kerja pembangunan disebut harga berasingan.",
};

export const hostingCovers: List = {
  en: ["Servers", "DNS", "SSL certificate", "Daily backups kept for 30 days", "Uptime monitoring", "Security patches", "Fixes to work we delivered"],
  ms: ["Pelayan", "DNS", "Sijil SSL", "Sandaran harian disimpan 30 hari", "Pemantauan masa operasi", "Tampalan keselamatan", "Pembaikan pada kerja yang kami serahkan"],
};

export const hostingNote: Text = {
  en: "Every delivered site pays Hosting yearly, priced per Package. Hosting doesn't include Content changes.",
  ms: "Setiap laman yang diserahkan membayar Hosting setiap tahun, mengikut Pakej. Hosting tidak termasuk Perubahan kandungan.",
};

const lower = (x: string) => (/^[A-Z][a-z]/.test(x) ? x[0].toLowerCase() + x.slice(1) : x);

export const hostingSentence = (l: "en" | "ms") => {
  const [first, ...rest] = hostingCovers[l];
  return `${first}, ${rest.slice(0, -1).map(lower).join(", ")} ${l === "en" ? "and" : "dan"} ${lower(rest.at(-1)!)}`;
};
