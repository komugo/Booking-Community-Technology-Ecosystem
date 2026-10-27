import type { Locale, Weekday } from "@komugo/db";

export type Alternates = Record<Locale, string>;

export const path = (l: Locale, ...parts: string[]) => "/" + [l === "ms" ? "ms" : "", ...parts].filter(Boolean).join("/");

export const rm = (sen: number) => `RM${sen % 100 ? (sen / 100).toFixed(2) : sen / 100}`;

export const WEEKDAYS: Weekday[] = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export const t = {
  en: {
    htmlLang: "en-MY",
    ogLocale: "en_MY",
    langName: "EN",
    home: "Home",
    min: "min",
    hour: "h",
    from: "From",
    unconfirmed: "unconfirmed",
    draftTitle: "Prices unconfirmed",
    draftBody: "This page is a draft built from public sources that may be out of date. Check prices and hours with the venue before you go.",
    homeTitle: "Komugo: horse riding and rock climbing in Putrajaya",
    homeDescription: "Horse rides, riding lessons and indoor climbing in Putrajaya. See every option, price and age limit before you go.",
    heroLines: ["Ride.", "Climb.", "Putrajaya."],
    heroAlt: "Rider jumping a bay horse over a rail",
    heroSub: "Horse rides, riding lessons and climbing sessions, with every price and age limit up front.",
    pickCategory: "Pick what you want to do",
    featured: "Places to go",
    cityCount: (n: number) => `${n} ${n === 1 ? "place" : "places"} to ride and climb`,
    trust: [
      ["A ticket for each person", "Everyone in your group gets their own named ticket, so check-in is quick."],
      ["Prices and limits up front", "Every option shows its price, duration and age limit before you go."],
      ["Online booking opens soon", "Compare places and prices now. Booking on Komugo is coming next."],
    ],
    cityTitle: (c: string) => `Things to do in ${c}: horse riding & climbing | Komugo`,
    cityDescription: (c: string) => `Horse riding and indoor rock climbing in ${c}, with prices, opening hours and age limits for each place.`,
    cityHeadline: (c: string) => ["Things to do", `in ${c}`],
    categoryTitle: (cat: string, c: string) => `${cat} in ${c}: prices and options | Komugo`,
    categoryDescription: (cat: string, c: string) => `Compare ${cat.toLowerCase()} in ${c}: every option with its price, duration and age limit.`,
    categoryHeadline: (cat: string, c: string) => [cat, `in ${c}`],
    allActivities: "All places",
    alsoIn: (c: string) => `Also in ${c}`,
    empty: "New places are being added. Check back soon.",
    activityTitle: (a: string, cat: string, price: string) => `${a}: ${cat.toLowerCase()} from ${price} | Komugo`,
    gallery: "Photos",
    prevPhoto: "Previous photo",
    nextPhoto: "Next photo",
    highlights: "Highlights",
    options: "Options",
    select: "Select",
    addOns: "Gear rental",
    addOnsNote: "Pay at the counter. Rental covers one session.",
    about: "About",
    goodToKnow: "Good to know",
    requirements: "Requirements",
    hours: "Opening hours",
    closed: "Closed",
    today: "Today",
    openToday: (h: string) => `Open today ${h}`,
    closedToday: "Closed today",
    cancellation: "Cancellation",
    cancelText: (h: number) => (h ? `Cancel for free up to ${h} hours before your session.` : "This activity can't be cancelled for free."),
    location: "Location",
    call: "Call",
    openMaps: "Open in Google Maps",
    faq: "Questions",
    related: "You might also like",
    book: "Booking",
    bookText: "Online booking opens soon. Until then, call the venue to book.",
    howToBook: "How to book",
    age: (min: number | null, max: number | null) =>
      min !== null && max !== null ? `Age ${min}–${max}` : min !== null ? `Age ${min}+` : max !== null ? `Up to age ${max}` : null,
    weight: (kg: number) => `Max ${kg} kg`,
    group: (n: number) => `Book for ${n} or more`,
    photoBy: "Photo",
    photosFrom: "Photos from",
    notFoundTitle: "Page not found",
    notFoundBody: "This page doesn't exist or has moved.",
    backHome: "Go to the home page",
    footer: "Book horse riding and climbing in Putrajaya.",
    weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  },
  ms: {
    htmlLang: "ms-MY",
    ogLocale: "ms_MY",
    langName: "BM",
    home: "Utama",
    min: "minit",
    hour: "jam",
    from: "Dari",
    unconfirmed: "belum disahkan",
    draftTitle: "Harga belum disahkan",
    draftBody: "Halaman ini draf daripada sumber awam yang mungkin sudah lapuk. Semak harga dan waktu operasi dengan pengendali sebelum datang.",
    homeTitle: "Komugo: menunggang kuda dan panjat tebing di Putrajaya",
    homeDescription: "Tunggang kuda, kelas menunggang dan panjat dinding dalaman di Putrajaya. Lihat setiap pilihan, harga dan had umur sebelum datang.",
    heroLines: ["Tunggang.", "Panjat.", "Putrajaya."],
    heroAlt: "Penunggang melompat dengan kuda perang melepasi palang",
    heroSub: "Tunggang kuda, kelas menunggang dan sesi memanjat, dengan harga dan had umur yang jelas.",
    pickCategory: "Pilih aktiviti anda",
    featured: "Tempat untuk dikunjungi",
    cityCount: (n: number) => `${n} tempat untuk menunggang dan memanjat`,
    trust: [
      ["Tiket untuk setiap orang", "Setiap ahli kumpulan dapat tiket bernama sendiri, jadi daftar masuk lebih cepat."],
      ["Harga dan had yang jelas", "Setiap pilihan menunjukkan harga, tempoh dan had umur sebelum anda datang."],
      ["Tempahan dalam talian akan dibuka", "Bandingkan tempat dan harga sekarang. Tempahan di Komugo akan menyusul."],
    ],
    cityTitle: (c: string) => `Aktiviti di ${c}: berkuda & panjat tebing | Komugo`,
    cityDescription: (c: string) => `Menunggang kuda dan panjat dinding dalaman di ${c}, dengan harga, waktu operasi dan had umur setiap tempat.`,
    cityHeadline: (c: string) => ["Aktiviti", `di ${c}`],
    categoryTitle: (cat: string, c: string) => `${cat} di ${c}: harga dan pilihan | Komugo`,
    categoryDescription: (cat: string, c: string) => `Bandingkan ${cat.toLowerCase()} di ${c}: setiap pilihan dengan harga, tempoh dan had umur.`,
    categoryHeadline: (cat: string, c: string) => [cat, `di ${c}`],
    allActivities: "Semua tempat",
    alsoIn: (c: string) => `Juga di ${c}`,
    empty: "Tempat baharu sedang ditambah. Sila semak semula nanti.",
    activityTitle: (a: string, cat: string, price: string) => `${a}: ${cat.toLowerCase()} dari ${price} | Komugo`,
    gallery: "Gambar",
    prevPhoto: "Gambar sebelumnya",
    nextPhoto: "Gambar seterusnya",
    highlights: "Sorotan",
    options: "Pilihan",
    select: "Pilih",
    addOns: "Sewa peralatan",
    addOnsNote: "Bayar di kaunter. Sewaan untuk satu sesi.",
    about: "Tentang",
    goodToKnow: "Perlu tahu",
    requirements: "Syarat",
    hours: "Waktu operasi",
    closed: "Tutup",
    today: "Hari ini",
    openToday: (h: string) => `Dibuka hari ini ${h}`,
    closedToday: "Tutup hari ini",
    cancellation: "Pembatalan",
    cancelText: (h: number) => (h ? `Batal secara percuma sehingga ${h} jam sebelum sesi anda.` : "Aktiviti ini tidak boleh dibatalkan secara percuma."),
    location: "Lokasi",
    call: "Hubungi",
    openMaps: "Buka di Google Maps",
    faq: "Soalan lazim",
    related: "Anda mungkin juga suka",
    book: "Tempahan",
    bookText: "Tempahan dalam talian akan dibuka tidak lama lagi. Buat masa ini, hubungi pengendali untuk menempah.",
    howToBook: "Cara menempah",
    age: (min: number | null, max: number | null) =>
      min !== null && max !== null ? `Umur ${min}–${max}` : min !== null ? `Umur ${min}+` : max !== null ? `Umur hingga ${max}` : null,
    weight: (kg: number) => `Maks ${kg} kg`,
    group: (n: number) => `Tempah untuk ${n} orang atau lebih`,
    photoBy: "Gambar",
    photosFrom: "Gambar daripada",
    notFoundTitle: "Halaman tidak dijumpai",
    notFoundBody: "Halaman ini tidak wujud atau telah dipindahkan.",
    backHome: "Ke halaman utama",
    footer: "Tempah menunggang kuda dan panjat dinding di Putrajaya.",
    weekdays: ["Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu", "Ahad"],
  },
} satisfies Record<Locale, unknown>;

export function duration(l: Locale, m: number) {
  const { min, hour } = t[l];
  if (m < 60) return `${m} ${min}`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} ${hour} ${m % 60} ${min}` : `${h} ${hour}`;
}

export function durationRange(l: Locale, a: number | null, b: number | null) {
  if (a === null || b === null) return null;
  if (a === b) return duration(l, a);
  return a < 60 && b < 60 ? `${a}–${b} ${t[l].min}` : `${duration(l, a)} – ${duration(l, b)}`;
}

export function time(l: Locale, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Intl.DateTimeFormat(l === "en" ? "en-MY" : "ms-MY", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
    Date.UTC(2000, 0, 1, h, m),
  );
}

export function todayKL(): Weekday {
  const d = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
  return d.slice(0, 2) as Weekday;
}

type Requirementful = { minAge: number | null; maxAge: number | null; maxWeightKg: number | null; minParticipants: number | null; requiredCert: string | null };

export const requirements = (l: Locale, o: Requirementful) =>
  [
    t[l].age(o.minAge, o.maxAge),
    o.maxWeightKg !== null && t[l].weight(o.maxWeightKg),
    o.minParticipants !== null && o.minParticipants > 1 && t[l].group(o.minParticipants),
    o.requiredCert,
  ].filter((x): x is string => typeof x === "string");
