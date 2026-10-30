// Turns the Putrajaya master list (data/putrajaya-master-list.csv) into the reviewed data file (data/putrajaya.json).
import { slugify } from "@komugo/db";
import { WEEKDAYS, type Weekday } from "@komugo/types";
import type { Catalogue, CatalogueActivity, CatalogueVenue, HowToBook, Hours, Note } from "./putrajaya-load";

type Row = {
  row: number;
  venue: string;
  address: string | null;
  presint: number | null;
  sport: string;
  operator: string | null;
  phone: string | null;
  booking: string | null;
  price: string | null;
  hours: string | null;
  komugo: string | null;
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') cell += text[++i];
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      rows.push([...row, cell]);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

const blank = (v: string | undefined) => {
  const s = v?.trim() ?? "";
  return s === "" || s === "—" || s === "Verify" ? null : s;
};

const toRow = (c: string[]): Row => {
  const presint = Number(blank(c[7]));
  return {
    row: Number(c[0]),
    venue: c[1].trim(),
    address: blank(c[4])?.replace("Precinct", "Presint") ?? null,
    presint: Number.isInteger(presint) && presint >= 1 && presint <= 20 ? presint : null,
    sport: c[9].trim(),
    operator: blank(c[15]),
    phone: blank(c[17])?.split("/")[0].trim() ?? null,
    booking: blank(c[19]),
    price: blank(c[21]),
    hours: blank(c[22]),
    komugo: blank(c[24]),
  };
};

const CITY: Catalogue["city"] = {
  id: "city_putrajaya",
  slugEn: "putrajaya",
  slugMs: "putrajaya",
  nameEn: "Putrajaya",
  nameMs: "Putrajaya",
  introEn:
    "Malaysia's garden capital sits about 30 minutes south of Kuala Lumpur, with lakes, parks and wide boulevards. Find courts, pools, water sports, cruises, parks and landmarks across its Presints.",
  introMs:
    "Ibu kota pentadbiran Malaysia yang hijau ini terletak kira-kira 30 minit ke selatan Kuala Lumpur, dikelilingi tasik, taman dan jalan raya yang lebar. Cari gelanggang, kolam renang, sukan air, pelayaran, taman dan mercu tanda di seluruh Presintnya.",
};

// Rows that name the same place.
const SAME_VENUE: Record<string, string> = {
  "Kompleks Sukan Taman Pancarona": "Taman Pancarona",
  "Putrajaya Lake Club": "Kelab Tasik Putrajaya",
  "Flyboard Malaysia": "Marina Putrajaya",
};

// English names only where one is in common use; the rest keep their Malay name.
const VENUE_EN: Record<string, string> = {
  "Kelab Tasik Putrajaya": "Putrajaya Lake Club",
  "Kompleks Sukan Air Putrajaya": "Putrajaya Water Sports Complex",
  "Pusat Rekreasi Air Putrajaya": "Putrajaya Water Recreation Centre",
  "Taman Cabaran Putrajaya": "Putrajaya Challenge Park",
  "Taman Ekuestrian Putrajaya": "Putrajaya Equestrian Park",
  "Taman Warisan Pertanian": "Agricultural Heritage Park",
  "Taman Wetland Putrajaya": "Putrajaya Wetland Park",
  "Taman Botani Putrajaya": "Putrajaya Botanical Garden",
  "Taman Persahabatan China–Malaysia": "China–Malaysia Friendship Garden",
  "Tasik Putrajaya": "Putrajaya Lake",
  "Kompleks Nasyrul Quran": "Nasyrul Quran Complex",
  "Dataran Putra": "Putra Square",
  "Jambatan Putra": "Putra Bridge",
  "Jambatan Seri Wawasan": "Seri Wawasan Bridge",
  "Jambatan Seri Gemilang": "Seri Gemilang Bridge",
  "Jambatan Seri Saujana": "Seri Saujana Bridge",
  "Jambatan Seri Bakti": "Seri Bakti Bridge",
  "Jambatan Seri Bestari": "Seri Bestari Bridge",
  "Jambatan Seri Setia": "Seri Setia Bridge",
  "Jambatan Seri Perdana": "Seri Perdana Bridge",
  "Jambatan Seri Ehsan": "Seri Ehsan Bridge",
  "Monumen Alaf Baru": "Millennium Monument",
};

// The list's own names are English; these are their Malay names.
const VENUE_MS: Record<string, string> = {
  "City Trail Putrajaya": "Denai Bandar Putrajaya",
  "Architectural Trails": "Denai Seni Bina Putrajaya",
  "Walking Trails Putrajaya": "Denai Pejalan Kaki Putrajaya",
  "Urban Birding Hotspot": "Lokasi Memerhati Burung Bandar",
};

type Operator = { id: string; name: string };
const PPJ: Operator = { id: "op_ppj", name: "Perbadanan Putrajaya (PPJ)" };
const MARINA: Operator = { id: "op_marina_putrajaya", name: "Marina Putrajaya Sdn Bhd" };
const OPERATORS: Record<string, Operator> = {
  PPJ,
  "Marina Putrajaya Sdn Bhd": MARINA,
  "Marina Putrajaya": MARINA,
  "Kelab Tasik Putrajaya": { id: "op_kelab_tasik_putrajaya", name: "Kelab Tasik Putrajaya" },
  "Flyboard Malaysia": { id: "op_flyboard_malaysia", name: "Flyboard Malaysia" },
  "IOI Sports Centre": { id: "op_ioi_sports_centre", name: "IOI Sports Centre" },
  "IOI City Mall": { id: "op_ioi_city_mall", name: "IOI City Mall" },
};
// Placeholders in the Operator column: who runs the place is unknown.
const UNKNOWN_OPERATOR = ["Operator", "Government"];

type Sport = { category: string; en: string; ms: string; place?: boolean };
const sport = (category: string, en: string, ms = en): Sport => ({ category: `cat_${category}`, en, ms });
// A place to visit takes its Venue's name; the label still makes its slug.
const visit = (category: string, en: string, ms: string): Sport => ({ ...sport(category, en, ms), place: true });
const sightseeing = visit("landmarks_tours", "Sightseeing", "Bersiar-siar");
const gardenVisit = visit("parks_cycling", "Garden visit", "Lawatan taman");
const parkVisit = visit("parks_cycling", "Park visit", "Lawatan taman");
const horseRiding = sport("horse_riding", "Horse riding", "Menunggang kuda");
const kayaking = sport("water_sports", "Kayaking", "Berkayak");
const waterRecreation = sport("water_sports", "Water recreation", "Rekreasi air");
const cycling = sport("parks_cycling", "Cycling", "Berbasikal");
const swimming = sport("swimming", "Swimming", "Renang");

const SPORTS: Record<string, Sport> = {
  "Sightseeing Cruise": sport("cruises_boats", "Sightseeing cruise", "Pelayaran bersiar-siar"),
  "Perahu Dondang Sayang": sport("cruises_boats", "Dondang Sayang boat ride", "Perahu Dondang Sayang"),
  "Private Boat Charter": sport("cruises_boats", "Private boat charter", "Sewa bot persendirian"),
  "Dine@Cruise": sport("cruises_boats", "Dine@Cruise"),
  "Venue Rental / Event": sport("cruises_boats", "Boat hire for events", "Sewa bot untuk acara"),
  "Boating / Water Recreation": sport("cruises_boats", "Boating", "Berperahu"),
  "Marina / Water Recreation": waterRecreation,
  "Water Recreation": waterRecreation,
  "Kayaking / Water Recreation": kayaking,
  Kayaking: kayaking,
  "Water Sports": sport("water_sports", "Water sports", "Sukan air"),
  Rowing: sport("water_sports", "Rowing", "Mendayung"),
  "Water Skiing": sport("water_sports", "Water skiing", "Ski air"),
  Wakeboarding: sport("water_sports", "Wakeboarding"),
  Flyboarding: sport("water_sports", "Flyboarding", "Flyboard"),
  "Lake Recreation": sport("water_sports", "Lake recreation", "Rekreasi tasik"),
  "Water Sports Events": sport("water_sports", "Water sports events", "Acara sukan air"),
  "Wall Climbing": sport("rock_climbing", "Wall climbing", "Panjat dinding"),
  "Adventure / Outdoor Recreation": sport("rock_climbing", "Outdoor adventure", "Pengembaraan luar"),
  "Indoor Adventure Park": visit("rock_climbing", "Indoor adventure park", "Taman pengembaraan dalaman"),
  Skateboarding: sport("parks_cycling", "Skateboarding", "Papan luncur"),
  BMX: sport("parks_cycling", "BMX"),
  "MTB / Mountain Biking": sport("parks_cycling", "Mountain biking", "Basikal gunung"),
  Cycling: cycling,
  "Cycling / MTB": sport("parks_cycling", "Cycling & mountain biking", "Berbasikal & basikal gunung"),
  "Cycling / Walking": sport("parks_cycling", "Cycling & walking", "Berbasikal & berjalan kaki"),
  "Walking / Jogging": sport("parks_cycling", "Walking & jogging", "Berjalan kaki & berjoging"),
  Jogging: sport("parks_cycling", "Jogging", "Berjoging"),
  "Jogging / Nature Walk": sport("parks_cycling", "Jogging & nature walk", "Berjoging & jelajah alam"),
  "Walking / Leisure": visit("parks_cycling", "Leisure walk", "Bersiar-siar"),
  "Botanical Garden": gardenVisit,
  "Garden / Sightseeing": gardenVisit,
  "Garden / Cultural": gardenVisit,
  "Garden / Recreation": gardenVisit,
  "Walking / Recreation": parkVisit,
  "Park / Recreation": parkVisit,
  "Lakeside Recreation": visit("parks_cycling", "Lakeside visit", "Rekreasi tepi tasik"),
  "Recreation / Events": sport("parks_cycling", "Recreation & events", "Rekreasi & acara"),
  "Horse Riding / Equestrian": horseRiding,
  "Horse Riding": horseRiding,
  Badminton: sport("badminton", "Badminton"),
  "Mini Futsal": sport("futsal", "Mini futsal", "Futsal mini"),
  Futsal: sport("futsal", "Futsal"),
  "Futsal – Mokhtar Dahari": sport("futsal", "Futsal (Mokhtar Dahari court)", "Futsal (gelanggang Mokhtar Dahari)"),
  "Open Futsal": sport("futsal", "Outdoor futsal", "Futsal luar"),
  Football: sport("football", "Football", "Bola sepak"),
  Pickleball: sport("pickleball", "Pickleball"),
  "Sepak Takraw": sport("sepak_takraw", "Sepak takraw"),
  Gym: sport("gym", "Gym", "Gim"),
  Squash: sport("squash", "Squash", "Skuasy"),
  Tennis: sport("tennis", "Tennis", "Tenis"),
  Basketball: sport("basketball", "Basketball", "Bola keranjang"),
  Volleyball: sport("volleyball_netball", "Volleyball", "Bola tampar"),
  Netball: sport("volleyball_netball", "Netball", "Bola jaring"),
  Swimming: swimming,
  "Swimming Pool": swimming,
  "Ice Skating": sport("ice_skating", "Ice skating", "Luncur ais"),
  "Agriculture / Farm Experience": sport("farms_nature", "Farm experience", "Pengalaman ladang"),
  "Fruit Farm Tour": sport("farms_nature", "Fruit farm tour", "Lawatan ladang buah"),
  "Animal / Plant Educational Experience": visit("farms_nature", "Animal & plant discovery", "Penerokaan haiwan & tumbuhan"),
  "Nature Walk": sport("farms_nature", "Nature walk", "Jelajah alam"),
  "Bird Watching": sport("farms_nature", "Birdwatching", "Memerhati burung"),
  "Educational / Wetland Experience": visit("farms_nature", "Wetland learning", "Pembelajaran tanah bencah"),
  "Glamping / Camping": visit("farms_nature", "Glamping", "Glamping"),
  "Walking / Sightseeing": visit("landmarks_tours", "Architecture walk", "Jelajah seni bina"),
  "Cultural / Tourist Experience": visit("landmarks_tours", "Cultural experience", "Pengalaman budaya"),
  "Islamic / Cultural Tourism": sightseeing,
  "Architecture / Sightseeing": sightseeing,
  "Landmark / Sightseeing": sightseeing,
  "Photography / Sightseeing": sightseeing,
  "Cultural / Architecture": sightseeing,
  "Landmark / Events": sightseeing,
  "Walking / Photography": sightseeing,
};

const RETAIL = ["Shopping / Entertainment", "Food / Shopping"];

function exclusion(r: Row): string | null {
  if (r.komugo === "N/A") return "Marked N/A for Komugo";
  if (r.booking?.includes("Restricted")) return `Public access restricted (${r.booking})`;
  if (RETAIL.includes(r.sport)) return `Retail, not an Activity (${r.sport})`;
  return null;
}

function howToBook(booking: string | null, unknownOperator: boolean): HowToBook {
  if (!booking || booking === "Various") return "unknown";
  if (/walk-in/i.test(booking)) return "walk_in";
  return unknownOperator ? "unknown" : "external";
}

const RANGE = /^RM(\d+)–RM(\d+)\/hr$/;
const PRICES: Record<string, [string, string]> = {
  Free: ["Free", "Percuma"],
  "Free/Verify": ["Free", "Percuma"],
  "Free daytime": ["Free in the daytime", "Percuma pada waktu siang"],
  "RM2 entry": ["RM2 entry", "Masuk RM2"],
  "From RM64": ["From RM64", "Dari RM64"],
  "Event-based": ["Depends on the event", "Bergantung pada acara"],
};

function priceNote(price: string | null): [string, string] | null {
  if (!price || price === "Various") return null;
  const range = RANGE.exec(price);
  if (range) return [`RM${range[1]}–RM${range[2]} per hour`, `RM${range[1]}–RM${range[2]} sejam`];
  return PRICES[price] ?? null;
}

const time = (t: string) => {
  const m = /^(\d{1,2})(am|pm)\+?$/.exec(t.trim());
  if (!m) return null;
  const h = (Number(m[1]) % 12) + (m[2] === "pm" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:00`;
};

const span = (s: string, days: Weekday[]): Hours | null => {
  const [opens, closes] = s.split("–").map(time);
  return opens && closes ? { days, opens, closes } : null;
};

export function parseHours(hours: string | null): Hours[] | null {
  if (!hours) return null;
  const split = /^(.+) weekdays; (.+) weekends$/.exec(hours);
  const parts = split ? [span(split[1], WEEKDAYS.slice(0, 5)), span(split[2], WEEKDAYS.slice(5))] : [span(hours, WEEKDAYS)];
  return parts.every((p) => p !== null) ? parts : null;
}

const same = <T>(xs: T[]) => xs.every((x) => JSON.stringify(x) === JSON.stringify(xs[0]));
const first = <T>(xs: (T | null)[]) => xs.find((x) => x !== null) ?? null;

// A page matches either language's slug, so neither may equal another row's EN or BM slug.
function slugPair(taken: Set<string>, en: string, ms: string) {
  const free = (slug: string) => {
    let s = slug;
    for (let n = 2; taken.has(s); n++) s = `${slug}-${n}`;
    taken.add(s);
    return s;
  };
  const slugEn = free(en);
  return { slugEn, slugMs: ms === en ? slugEn : free(ms) };
}

const idOf = (prefix: string, slug: string) => `${prefix}_${slug.replaceAll("-", "_")}`;

export function build(csv: string): Catalogue {
  const rows = parseCsv(csv)
    .slice(1)
    .filter((c) => c[0]?.trim())
    .map(toRow);
  const excluded: Catalogue["excluded"] = [];
  const review: Note[] = [];
  const note = (rs: Row[], text: string) => review.push({ rows: rs.map((r) => r.row), note: text });
  const kept: (Row & { place: string })[] = [];
  for (const r of rows) {
    const reason = exclusion(r) ?? (SPORTS[r.sport] ? null : "Could not classify");
    if (reason) excluded.push({ row: r.row, venue: r.venue, activity: r.sport, reason });
    else kept.push({ ...r, place: SAME_VENUE[r.venue] ?? r.venue });
  }

  const venueSlugs = new Set<string>();
  const activitySlugs = new Set<string>();
  const operators = new Map<string, Catalogue["operators"][number]>();
  const venues: CatalogueVenue[] = [];
  const activities: CatalogueActivity[] = [];

  for (const place of new Set(kept.map((r) => r.place))) {
    const at = kept.filter((r) => r.place === place);
    const nameMs = VENUE_MS[place] ?? place;
    const nameEn = VENUE_EN[place] ?? place;
    const slugs = slugPair(venueSlugs, slugify(nameEn), slugify(nameMs));
    const names = [...new Set(at.map((r) => r.venue))];
    if (names.length > 1) note(at, `Merged Venue: ${names.join(" + ")} → ${nameMs}`);

    const groups = new Map<string, typeof at>();
    for (const r of at) groups.set(SPORTS[r.sport].en, [...(groups.get(SPORTS[r.sport].en) ?? []), r]);
    const hours = [...groups.values()].map((g) => parseHours(first(g.map((r) => r.hours))));
    const shared = hours[0] && same(hours) ? hours[0] : null;
    const phone = first(at.map((r) => r.phone));
    const streetAddress = first(at.map((r) => (r.address === "Putrajaya" || r.address === "Various" ? null : r.address)));
    const presint = first(at.map((r) => r.presint));
    if (!streetAddress && !presint) note(at, `No location for ${nameMs}: needs an address and map pin`);
    const venue: CatalogueVenue = {
      id: idOf("ven", slugs.slugEn),
      ...slugs,
      nameEn,
      nameMs,
      streetAddress,
      presint,
      phone,
      openingHours: shared ?? [],
      rows: at.map((r) => r.row),
    };
    venues.push(venue);

    [...groups.values()].forEach((g, i) => {
      const s = SPORTS[g[0].sport];
      const sports = [...new Set(g.map((r) => r.sport))];
      if (g.length > 1) note(g, `Merged Activity at ${nameMs}: ${sports.join(" + ")} → ${s.en}`);
      const label = first(g.map((r) => r.operator));
      const unknown = !label || UNKNOWN_OPERATOR.includes(label);
      if (!unknown && !OPERATORS[label]) throw new Error(`Row ${g[0].row}: unmapped Operator "${label}"`);
      const operator = unknown ? { id: idOf("op", slugs.slugEn), name: nameMs, unknown: true } : OPERATORS[label];
      if (unknown) note(g, `Unknown Operator ("${label ?? "—"}") at ${nameMs}: placeholder Operator, stays Hidden`);
      const op = operators.get(operator.id) ?? { ...operator, rows: [] };
      op.rows.push(...g.map((r) => r.row));
      operators.set(op.id, op);

      const rawPrice = first(g.map((r) => r.price));
      const price = priceNote(rawPrice);
      if (rawPrice === "Free/Verify") note(g, `Price "Free/Verify" read as Free`);
      else if (rawPrice && !price) note(g, `Price "${rawPrice}" not imported`);
      const rawHours = first(g.map((r) => r.hours));
      if (rawHours && !hours[i]) note(g, `Hours "${rawHours}" not parsed`);
      if (rawHours?.endsWith("+")) note(g, `Hours "${rawHours}" read without the "+"`);
      const own = first(g.map((r) => r.phone));
      const actSlugs = slugPair(activitySlugs, `${slugs.slugEn}-${slugify(s.en)}`, `${slugs.slugMs}-${slugify(s.ms)}`);
      activities.push({
        id: idOf("act", actSlugs.slugEn),
        venueId: venue.id,
        operatorId: operator.id,
        categoryId: s.category,
        ...actSlugs,
        nameEn: s.place ? nameEn : `${s.en} at ${nameEn}`,
        nameMs: s.place ? nameMs : `${s.ms} di ${nameMs}`,
        listingMode: "hidden",
        howToBook: howToBook(first(g.map((r) => r.booking)), unknown),
        priceNoteEn: price?.[0] ?? null,
        priceNoteMs: price?.[1] ?? null,
        phone: own === phone ? null : own,
        openingHours: shared ? [] : (hours[i] ?? []),
        rows: g.map((r) => r.row),
      });
    });
  }

  return { source: "data/putrajaya-master-list.csv", city: CITY, operators: [...operators.values()], venues, activities, excluded, review };
}
