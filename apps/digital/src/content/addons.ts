import type { Fee, Text } from "./i18n";

export type Addon = { name: Text; fee: Fee };

export const addons: Addon[] = [
  { name: { en: "Additional website page", ms: "Halaman laman web tambahan" }, fee: { min: 250, max: 500 } },
  { name: { en: "Logo and basic branding", ms: "Logo dan penjenamaan asas" }, fee: { min: 800, max: 2000 } },
  { name: { en: "Copywriting", ms: "Penulisan kandungan" }, fee: { min: 300, max: 1000 } },
  { name: { en: "English and BM translation", ms: "Terjemahan Bahasa Inggeris dan BM" }, fee: { min: 500, max: 1500 } },
  { name: { en: "Advanced SEO setup", ms: "Persediaan SEO lanjutan" }, fee: { min: 1000, max: 3000 } },
  { name: { en: "Appointment booking module", ms: "Modul tempahan temu janji" }, fee: { min: 2000, max: 5000 } },
  { name: { en: "Online payment integration", ms: "Integrasi bayaran dalam talian" }, fee: { min: 1000, max: 3000 } },
  { name: { en: "Customer login and membership", ms: "Log masuk dan keahlian pelanggan" }, fee: { min: 2500, max: 6000 } },
  { name: { en: "Admin dashboard", ms: "Papan pemuka admin" }, fee: { min: 3000, max: 8000 } },
  { name: { en: "WhatsApp automation", ms: "Automasi WhatsApp" }, fee: { min: 1000, max: 3000 } },
  { name: { en: "API integration", ms: "Integrasi API" }, fee: { min: 2000, max: 8000 } },
  { name: { en: "Custom mobile application", ms: "Aplikasi mudah alih khas" }, fee: { min: 20000, from: true } },
];

export const addonNote: Text = {
  en: "Indicative prices. The final figure depends on integrations, third-party licensing and complexity.",
  ms: "Harga anggaran. Jumlah akhir bergantung pada integrasi, lesen pihak ketiga dan kerumitan.",
};
