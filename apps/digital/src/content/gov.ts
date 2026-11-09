import type { Fee, List, Text } from "./i18n";

export type GovPackageId = "gov-landing" | "gov-portal" | "gov-booking" | "gov-custom";

export type GovPackage = { id: GovPackageId; letter: string; name: Text; fee: Fee; includes: List };

export const govPackages: GovPackage[] = [
  {
    id: "gov-landing",
    letter: "A",
    name: { en: "Government landing page", ms: "Laman pendaratan kerajaan" },
    fee: { min: 5000, max: 10000 },
    includes: {
      en: ["Official department landing page", "Announcements", "Contact information", "Responsive design", "Basic accessibility and SEO"],
      ms: ["Laman pendaratan rasmi jabatan", "Pengumuman", "Maklumat perhubungan", "Reka bentuk responsif", "Kebolehcapaian dan SEO asas"],
    },
  },
  {
    id: "gov-portal",
    letter: "B",
    name: { en: "Government corporate portal", ms: "Portal korporat kerajaan" },
    fee: { min: 15000, max: 35000 },
    includes: {
      en: ["Full department website", "Multiple divisions", "News and announcements", "Document downloads", "Content management system", "Bilingual interface"],
      ms: ["Laman web jabatan lengkap", "Berbilang bahagian", "Berita dan pengumuman", "Muat turun dokumen", "Sistem pengurusan kandungan", "Antara muka dwibahasa"],
    },
  },
  {
    id: "gov-booking",
    letter: "C",
    name: { en: "Government booking portal", ms: "Portal tempahan kerajaan" },
    fee: { min: 30000, max: 80000 },
    includes: {
      en: ["Facility reservation", "Online application forms", "User registration", "Booking management", "Payment integration where applicable", "Administrative dashboard"],
      ms: ["Tempahan kemudahan", "Borang permohonan dalam talian", "Pendaftaran pengguna", "Pengurusan tempahan", "Integrasi pembayaran jika berkaitan", "Papan pemuka pentadbiran"],
    },
  },
  {
    id: "gov-custom",
    letter: "D",
    name: { en: "Government custom system", ms: "Sistem khas kerajaan" },
    fee: { min: 80000, max: 300000, plus: true },
    includes: {
      en: [
        "Custom web applications",
        "Database development",
        "Workflow automation",
        "Multi-department access",
        "Reporting systems",
        "API integrations",
        "Security controls",
        "Training and documentation",
        "Ongoing technical support",
      ],
      ms: [
        "Aplikasi web khas",
        "Pembangunan pangkalan data",
        "Automasi aliran kerja",
        "Akses pelbagai jabatan",
        "Sistem pelaporan",
        "Integrasi API",
        "Kawalan keselamatan",
        "Latihan dan dokumentasi",
        "Sokongan teknikal berterusan",
      ],
    },
  },
];

export const govDocuments: List = {
  en: [
    "Company profile",
    "Technical proposal",
    "Project implementation plan",
    "Project timeline",
    "Detailed quotation",
    "System architecture",
    "Security and data management plan",
    "Maintenance and SLA proposal",
    "User training and handover documentation",
  ],
  ms: [
    "Profil syarikat",
    "Cadangan teknikal",
    "Pelan pelaksanaan projek",
    "Jadual projek",
    "Sebut harga terperinci",
    "Seni bina sistem",
    "Pelan keselamatan dan pengurusan data",
    "Cadangan penyelenggaraan dan SLA",
    "Dokumentasi latihan pengguna dan serahan",
  ],
};

export const govNote: Text = {
  en: "Indicative prices, subject to scope, procurement and approval. Government projects are priced on actual requirements, procurement conditions and contractual obligations.",
  ms: "Harga anggaran, tertakluk kepada skop, perolehan dan kelulusan. Projek kerajaan diberi harga mengikut keperluan sebenar, syarat perolehan dan obligasi kontrak.",
};

export const procurements = ["direct", "quotation", "tender"] as const;
