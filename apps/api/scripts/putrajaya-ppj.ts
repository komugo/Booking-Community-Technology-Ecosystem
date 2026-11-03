// Catalogue facts from PPJ's public sport page (https://spt.ppj.gov.my/sport): names, rates and court counts only.
// Facility pages, availability and booking endpoints sit behind login and are never requested.
import type { Catalogue } from "./putrajaya-load";

export const PPJ_URL = "https://spt.ppj.gov.my/sport";

export type Facility = {
  id: number;
  name: string;
  location: string;
  rate: { rm: number; per: "hour" | "session" } | null;
  courts: number | null;
};

// PPJ facility id → Activity it describes. PPJ facilities without one are listed in the report for staff to map.
const MATCH: [number, string][] = [
  [2, "act_kompleks_kejiranan_presint_8_badminton"],
  [13, "act_kompleks_kejiranan_presint_9_squash"],
  [17, "act_kompleks_kejiranan_presint_9_gym"],
  [23, "act_kompleks_kejiranan_presint_11_badminton"],
  [27, "act_kompleks_kejiranan_presint_11_basketball"],
  [29, "act_kompleks_kejiranan_presint_11_squash"],
  [30, "act_kompleks_kejiranan_presint_11_tennis"],
  [34, "act_kompleks_kejiranan_presint_16_badminton"],
  [38, "act_kompleks_kejiranan_presint_16_squash"],
  [41, "act_kompleks_kejiranan_presint_16_gym"],
  [58, "act_taman_pancarona_football"],
  [59, "act_taman_pancarona_futsal"],
  [59, "act_taman_pancarona_basketball"],
  [60, "act_taman_pancarona_sepak_takraw"],
  [61, "act_taman_pancarona_volleyball"],
  [62, "act_taman_pancarona_netball"],
  [70, "act_taman_pancarona_netball"],
  [63, "act_kompleks_futsal_presint_18_futsal_mokhtar_dahari_court"],
];

const PER: Record<string, "hour" | "session"> = { Jam: "hour", Sesi: "session" };

const text = (s: string) =>
  s
    .replaceAll("&amp;", "&")
    .replaceAll("&#039;", "'")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ")
    .trim();

export function parseSport(html: string): Facility[] {
  const cards = html.split("<!--begin::Product-->").slice(1).map((c) => c.split("<!--end::Product-->")[0]);
  const peta = html.match(/var peta = (\[.*?\]);\n/s);
  if (!peta) throw new Error("PPJ page changed: facility list not found");
  const listed = JSON.parse(peta[1]) as { id: number; eft_type_desc: string; highlight: string | null }[];
  if (listed.length !== cards.length) throw new Error(`PPJ page changed: ${cards.length} cards, ${listed.length} facilities`);
  return cards.map((card, i) => {
    const f = listed[i];
    const name = text(card.match(/text-hover-primary mb-1">([^<]*)</)?.[1] ?? "");
    if (name !== text(f.eft_type_desc)) throw new Error(`PPJ page changed: card "${name}" vs facility ${f.id} "${f.eft_type_desc}"`);
    const price = card.match(/text-danger font-size-h6">RM\s*([\d.]+)<\/span>\s*\/\s*(\w+)/);
    const per = price ? PER[price[2]] : undefined;
    const courts = f.highlight?.match(/mempunyai (\d+) gelanggang/)?.[1];
    return {
      id: f.id,
      name,
      location: text(card.match(/text-muted font-weight-bold">([^<]*)</)?.[1] ?? ""),
      rate: price && per ? { rm: Number(price[1]), per } : null,
      courts: courts ? Number(courts) : null,
    };
  });
}

function priceNote({ rm, per }: NonNullable<Facility["rate"]>) {
  const amount = `RM${Number.isInteger(rm) ? rm : rm.toFixed(2)}`;
  return per === "hour" ? { en: `${amount} per hour`, ms: `${amount} sejam` } : { en: `${amount} per session`, ms: `${amount} satu sesi` };
}

// RM0 next to a counter booking may mean the price isn't published, so it is reported for staff, never filled as free.
const priced = (f: Facility) => !!f.rate && f.rate.rm > 0;

// Fills only empty fields: a price from the master list always wins over PPJ's.
export function fill(data: Catalogue, facilities: Facility[]): Catalogue {
  const rates = new Map(facilities.filter(priced).map((f) => [f.id, f.rate!]));
  const activities = data.activities.map((a) => {
    if (a.priceNoteEn !== null || a.priceNoteMs !== null) return a;
    const rate = MATCH.filter(([, id]) => id === a.id).map(([ppj]) => rates.get(ppj)).find(Boolean);
    if (!rate) return a;
    const note = priceNote(rate);
    return { ...a, priceNoteEn: note.en, priceNoteMs: note.ms };
  });
  return { ...data, activities };
}

export function report(facilities: Facility[], before: Catalogue, after: Catalogue): string[] {
  const old = new Map(before.activities.map((a) => [a.id, a]));
  const changed = after.activities.filter((a) => {
    const was = old.get(a.id);
    return was && (was.priceNoteEn !== a.priceNoteEn || was.priceNoteMs !== a.priceNoteMs);
  });
  const ids = new Set(after.activities.map((a) => a.id));
  const rate = (f: Facility) => (f.rate ? `RM${f.rate.rm}/${f.rate.per}` : "-");
  return [
    `PPJ facilities: ${facilities.length}, ${facilities.filter((f) => MATCH.some(([id]) => id === f.id)).length} matched`,
    `Changed: ${changed.length}`,
    ...changed.map((a) => `~ activity ${a.id}  price=${a.priceNoteEn} / ${a.priceNoteMs}  (was ${old.get(a.id)!.priceNoteEn ?? "-"})`),
    ...facilities
      .filter((f) => f.rate?.rm === 0 && MATCH.some(([id]) => id === f.id))
      .map((f) => `? ppj ${f.id}  ${f.name}, ${f.location}  rate=RM0/${f.rate!.per}  (not filled: confirm the price with PPJ)`),
    ...facilities
      .filter((f) => !MATCH.some(([id]) => id === f.id))
      .map((f) => `? ppj ${f.id}  ${f.name}, ${f.location}  rate=${rate(f)}  courts=${f.courts ?? "-"}  (no Activity)`),
    ...MATCH.filter(([, id]) => !ids.has(id)).map(([ppj, id]) => `! ppj ${ppj}: ${id} not in the data file`),
  ];
}
