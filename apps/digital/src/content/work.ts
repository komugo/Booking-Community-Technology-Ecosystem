import type { List, Text } from "./i18n";

export type CaseStudy = { slug: "komugo-platform" | "dialisis-my"; name: string; url: string; kind: Text; summary: Text; tags: List; image: string; imageAlt: Text };

export const caseStudies: CaseStudy[] = [
  {
    slug: "komugo-platform",
    name: "Komugo Platform",
    url: "https://komugo.com",
    kind: { en: "Our own booking and ticketing product", ms: "Produk tempahan dan tiket kami sendiri" },
    summary: {
      en: "A booking and ticketing marketplace for activities in Putrajaya: live availability, named tickets, online payment and a dashboard for venue staff. Soft-launched in Putrajaya.",
      ms: "Pasaran tempahan dan tiket untuk aktiviti di Putrajaya: kekosongan masa nyata, tiket bernama, bayaran dalam talian dan papan pemuka untuk kakitangan lokasi. Sudah dilancarkan secara terhad di Putrajaya.",
    },
    tags: { en: ["Booking engine", "Payments", "Staff dashboard", "EN + BM"], ms: ["Enjin tempahan", "Pembayaran", "Papan pemuka staf", "EN + BM"] },
    image: "/work/komugo-platform-activity.jpg",
    imageAlt: { en: "Komugo Platform activity page for badminton, with opening hours and a How to book button", ms: "Halaman aktiviti badminton Komugo Platform, dengan waktu operasi dan butang How to book" },
  },
  {
    slug: "dialisis-my",
    name: "dialisis.my",
    url: "https://dialisis.my",
    kind: { en: "Our founder's earlier work", ms: "Hasil kerja terdahulu pengasas kami" },
    summary: {
      en: "A directory that helps patients and families find dialysis centres in Malaysia, built by one of our founders before Komugo Digital.",
      ms: "Direktori yang membantu pesakit dan keluarga mencari pusat dialisis di Malaysia, dibina oleh salah seorang pengasas kami sebelum Komugo Digital.",
    },
    tags: { en: ["Directory", "Search", "SEO"], ms: ["Direktori", "Carian", "SEO"] },
    image: "/work/dialisis-my-home.jpg",
    imageAlt: { en: "dialisis.my home page with dialysis centre search", ms: "Halaman utama dialisis.my dengan carian pusat dialisis" },
  },
];
