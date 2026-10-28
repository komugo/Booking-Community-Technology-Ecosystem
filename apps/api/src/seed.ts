// Draft catalogue from public web sources (may be stale; every Activity stays unpublished until staff verify):
// malaysia-traveller.com, says.com, visitselangor.com, zafigo.com, thesmartlocal.my, timeout.com.
// Photos: free Unsplash License, hotlinked from images.unsplash.com.
import { booking, type AddOnInput, type OptionInput, type ResourceInput, type ResourceKind } from "@komugo/booking";
import { activities, categories, cities, createDb, members, operators, photos, projAddOns, projOptions } from "@komugo/db";
import { klDate, WEEKDAYS } from "@komugo/types";
import { count, inArray } from "drizzle-orm";

type PhotoSeed = Omit<typeof photos.$inferInsert, "activityId" | "position">;
type HubSeed = typeof cities.$inferInsert & { id: string; photo: PhotoSeed };
type OptionSeed = Pick<OptionInput, "id" | "nameEn" | "nameMs" | "priceSen" | "durationMinutes"> &
  Partial<Pick<OptionInput, "minAge" | "maxAge" | "maxWeightKg" | "minParticipants" | "requiredCert">> & {
    needs: Partial<Record<ResourceKind, number>>;
  };
type ResourceSeed = Pick<ResourceInput, "id" | "kind" | "name"> &
  Partial<Pick<ResourceInput, "maxSessionsPerDay" | "restMinutes" | "maxRiderWeightKg">>;
type ActivitySeed = Omit<typeof activities.$inferInsert, "operatorId" | "cityId" | "categoryId" | "published"> & {
  id: string;
  operator: { id: string; name: string };
  category: HubSeed;
  freeCancelHours: number;
  closedDays: string[];
  scheduleId: string;
  options: OptionSeed[];
  addOns: Omit<AddOnInput, "activityId" | "active">[];
  resources: ResourceSeed[];
  photos: PhotoSeed[];
};

const unsplash = (
  photoId: string,
  pageId: string,
  width: number,
  height: number,
  creditName: string,
  username: string,
  altEn: string,
  altMs: string,
): PhotoSeed => ({
  id: `ph_${pageId}`,
  url: `https://images.unsplash.com/photo-${photoId}`,
  width,
  height,
  altEn,
  altMs,
  creditName,
  creditUrl: `https://unsplash.com/@${username}?utm_source=komugo&utm_medium=referral`,
  sourceUrl: `https://unsplash.com/photos/${pageId}`,
});

const putrajaya: HubSeed = {
  id: "city_putrajaya",
  slugEn: "putrajaya",
  slugMs: "putrajaya",
  nameEn: "Putrajaya",
  nameMs: "Putrajaya",
  introEn:
    "Malaysia's garden capital sits about 30 minutes south of Kuala Lumpur, with lakes, parks and wide boulevards. In Presint 5 you can ride horses at the Equestrian Park or spend an evening on the walls at the Challenge Park.",
  introMs:
    "Ibu kota pentadbiran Malaysia yang hijau ini terletak kira-kira 30 minit ke selatan Kuala Lumpur, dikelilingi tasik, taman dan jalan raya yang lebar. Di Presint 5, anda boleh menunggang kuda di Taman Ekuestrian atau habiskan petang memanjat dinding di Taman Cabaran.",
  photo: unsplash("1574310886178-20688c28aeb1", "_u_wI4LaT7o", 4256, 2832, "Alex Hudson", "aliffhassan91", "Putra Mosque beside Putrajaya Lake", "Masjid Putra di tepi Tasik Putrajaya"),
};

const horseRiding: HubSeed = {
  id: "cat_horse_riding",
  slugEn: "horse-riding",
  slugMs: "menunggang-kuda",
  nameEn: "Horse riding",
  nameMs: "Menunggang kuda",
  introEn:
    "From a 15-minute joy ride to a 45-minute lesson with an instructor, horse riding in Putrajaya suits first-timers and kids as well as riders who want to improve. Every option lists its age and rider-weight limits, so you know before you book.",
  introMs:
    "Daripada tunggangan santai 15 minit hingga kelas 45 minit bersama jurulatih, menunggang kuda di Putrajaya sesuai untuk pemula dan kanak-kanak, juga mereka yang mahu memperbaiki kemahiran. Setiap pilihan menyatakan had umur dan berat penunggang, jadi anda tahu lebih awal sebelum menempah.",
  photo: unsplash("1594768816441-1dd241ffaa67", "9h_bJdGqzCk", 5184, 3456, "Mikayla Storms", "mikham", "Rider on a chestnut horse in an outdoor arena", "Penunggang di atas kuda perang di gelanggang terbuka"),
};

const rockClimbing: HubSeed = {
  id: "cat_rock_climbing",
  slugEn: "rock-climbing",
  slugMs: "panjat-tebing",
  nameEn: "Rock climbing",
  nameMs: "Panjat tebing",
  introEn:
    "Indoor wall climbing in Putrajaya costs a few ringgit for a 3-hour session, with gear to rent on site and instructors for beginners. It's air-conditioned and open late, which makes it an easy weeknight plan.",
  introMs:
    "Panjat dinding tertutup di Putrajaya hanya beberapa ringgit untuk sesi 3 jam, dengan peralatan boleh disewa di tapak dan jurulatih untuk pemula. Berhawa dingin dan dibuka hingga lewat malam, sesuai untuk aktiviti selepas kerja.",
  photo: unsplash("1696105538782-7815474f28e0", "TDhpTIK-neM", 6000, 4000, "Nathan Cima", "nathan_cima", "Climber on a bright yellow and orange wall", "Pemanjat di dinding berwarna kuning dan oren"),
};

const PRESINT_5 = { streetAddress: "Presint 5", postalCode: "62200" };

const equestrian: ActivitySeed = {
  id: "act_equestrian",
  operator: { id: "op_equestrian", name: "Putrajaya Equestrian Park" },
  category: horseRiding,
  slugEn: "putrajaya-equestrian-park",
  slugMs: "taman-ekuestrian-putrajaya",
  nameEn: "Putrajaya Equestrian Park",
  nameMs: "Taman Ekuestrian Putrajaya",
  descriptionEn:
    "A public equestrian park in Presint 5 with free entry. Take a short joy ride, put the kids on a pony, or book a 45-minute lesson with an instructor, from a first-timer group class to one-to-one coaching. Between rides you can tour the stables, walk the 2 km sand trail, and catch polo when a match is on.",
  descriptionMs:
    "Taman ekuestrian awam di Presint 5 dan masuknya percuma. Cuba tunggangan santai yang singkat, biar si kecil naik kuda padi, atau tempah kelas 45 minit bersama jurulatih, sama ada kelas berkumpulan untuk pemula atau sesi persendirian. Sementara itu, boleh lawat kandang kuda, berjalan di denai pasir sejauh 2 km dan tonton perlawanan polo jika ada.",
  freeCancelHours: 24,
  closedDays: ["Mo"],
  scheduleId: "sch_eq_daily",
  ...PRESINT_5,
  phone: "+60 3-8000 8902",
  openingHours: [{ days: ["Tu", "We", "Th", "Fr", "Sa", "Su"], opens: "08:30", closes: "17:30" }],
  hoursNoteEn: "Closed on Mondays. One source lists closing at 7pm, so check before you go.",
  hoursNoteMs: "Tutup setiap Isnin. Ada sumber menyatakan waktu tutup 7 malam, jadi semak dahulu sebelum datang.",
  highlightsEn: ["Free entry to the park", "Stable tours", "Photoshoots with the horses", "2 km sand trail", "Polo matches to watch"],
  highlightsMs: ["Masuk ke taman percuma", "Lawatan ke kandang kuda", "Sesi bergambar bersama kuda", "Denai pasir sejauh 2 km", "Tonton perlawanan polo"],
  faqEn: [
    { q: "Do I pay to enter the park?", a: "No. Entry is free; you only pay for rides and lessons." },
    { q: "Is the park open on Mondays?", a: "No, it is closed every Monday." },
    { q: "Can I join a group lesson on my own?", a: "Group lessons need at least 2 riders. Book a private lesson if you are riding alone." },
    {
      q: "Are there lesson packages?",
      a: "Older sources list an 8-lesson pack from RM380, and newer ones list level-based packages from RM600 to RM900. These prices are unconfirmed.",
    },
  ],
  faqMs: [
    { q: "Perlu bayar untuk masuk ke taman?", a: "Tidak. Masuk percuma; anda hanya bayar untuk tunggangan dan kelas." },
    { q: "Adakah taman dibuka pada hari Isnin?", a: "Tidak, taman tutup setiap Isnin." },
    { q: "Boleh saya sertai kelas berkumpulan seorang diri?", a: "Kelas berkumpulan memerlukan sekurang-kurangnya 2 penunggang. Jika datang seorang, tempah kelas persendirian." },
    {
      q: "Ada pakej kelas?",
      a: "Sumber lama menyebut pakej 8 kelas dari RM380, manakala sumber terkini menyenaraikan pakej mengikut tahap antara RM600 hingga RM900. Harga ini belum disahkan.",
    },
  ],
  options: [
    { id: "opt_eq_joy_adult", nameEn: "Joy ride (adult)", nameMs: "Tunggangan santai (dewasa)", priceSen: 2000, durationMinutes: 15, minAge: 13, maxWeightKg: 80, needs: { horse: 1 } },
    { id: "opt_eq_joy_child", nameEn: "Joy ride (child)", nameMs: "Tunggangan santai (kanak-kanak)", priceSen: 1500, durationMinutes: 15, maxAge: 12, maxWeightKg: 80, needs: { horse: 1 } },
    { id: "opt_eq_pony", nameEn: "Pony ride", nameMs: "Tunggangan kuda padi", priceSen: 2000, durationMinutes: 20, maxAge: 10, maxWeightKg: 35, needs: { horse: 1 } },
    // Needs are per rider; one shared instructor per group is not tracked as a Resource yet.
    { id: "opt_eq_group_lesson", nameEn: "Group lesson with instructor", nameMs: "Kelas berkumpulan bersama jurulatih", priceSen: 6000, durationMinutes: 45, minAge: 7, maxWeightKg: 90, minParticipants: 2, needs: { horse: 1 } },
    { id: "opt_eq_private_lesson", nameEn: "Private lesson", nameMs: "Kelas persendirian", priceSen: 7000, durationMinutes: 45, minAge: 7, maxWeightKg: 90, needs: { horse: 1, instructor: 1 } },
  ],
  addOns: [],
  resources: [
    { id: "res_eq_bayu", kind: "horse", name: "Bayu", maxSessionsPerDay: 6, restMinutes: 15, maxRiderWeightKg: 90 },
    { id: "res_eq_kilat", kind: "horse", name: "Kilat", maxSessionsPerDay: 6, restMinutes: 15, maxRiderWeightKg: 90 },
    { id: "res_eq_seri", kind: "horse", name: "Seri", maxSessionsPerDay: 6, restMinutes: 15, maxRiderWeightKg: 80 },
    { id: "res_eq_melati", kind: "horse", name: "Melati", maxSessionsPerDay: 6, restMinutes: 15, maxRiderWeightKg: 80 },
    { id: "res_eq_comel", kind: "horse", name: "Comel (pony)", maxSessionsPerDay: 8, restMinutes: 10, maxRiderWeightKg: 35 },
    { id: "res_eq_manis", kind: "horse", name: "Manis (pony)", maxSessionsPerDay: 8, restMinutes: 10, maxRiderWeightKg: 35 },
    { id: "res_eq_instructor_1", kind: "instructor", name: "Instructor 1" },
    { id: "res_eq_instructor_2", kind: "instructor", name: "Instructor 2" },
  ],
  photos: [
    unsplash("1532876075969-8c016daf9242", "5XCIhfb_Dpc", 3747, 5064, "Fernando Puente", "fernandopuente", "Rider on a horse silhouetted against a pale sky", "Penunggang kuda berlatarkan langit cerah"),
    unsplash("1508343919546-4a5792fee935", "QrJc1RVI7uM", 4510, 3007, "Kenny Webster", "kwebster", "Person with a horse in a stable doorway", "Seseorang bersama kuda di pintu kandang"),
    unsplash("1541472630359-01e094ba899c", "DvjWMZ4viw8", 3648, 5472, "Emma Dau", "daugirl", "Rider on a spotted horse on a grassy trail", "Penunggang di atas kuda bertompok di denai berumput"),
    unsplash("1631364918274-0e7159557db2", "sc7WeqeVU_s", 4800, 3200, "Nik", "helloimnik", "Child on a chestnut pony led by an adult", "Kanak-kanak menunggang kuda padi berwarna perang dipimpin orang dewasa"),
  ],
};

const challengePark: ActivitySeed = {
  id: "act_challenge_park",
  operator: { id: "op_challenge_park", name: "Putrajaya Challenge Park" },
  category: rockClimbing,
  slugEn: "putrajaya-challenge-park",
  slugMs: "taman-cabaran-putrajaya",
  nameEn: "Putrajaya Challenge Park",
  nameMs: "Taman Cabaran Putrajaya",
  descriptionEn:
    "An indoor climbing complex in Presint 5 where one ticket gets you a 3-hour session on the walls. Bring your own gear or rent a rope, harness, shoes, belay device and chalk bag at the counter. First-timers climb with an instructor, and children under 10 have their own kids' room.",
  descriptionMs:
    "Kompleks panjat dinding tertutup di Presint 5. Satu tiket memberi anda sesi 3 jam di dinding panjat. Bawa peralatan sendiri atau sewa tali, abah-abah, kasut, alat belay dan beg kapur di kaunter. Pemula wajib memanjat bersama jurulatih, dan kanak-kanak bawah 10 tahun ada bilik khas mereka sendiri.",
  freeCancelHours: 24,
  closedDays: ["Mo#1", "Mo#3"],
  scheduleId: "sch_cp_daily",
  ...PRESINT_5,
  phone: "+60 3-8887 7000",
  openingHours: [
    { days: ["Mo", "Tu", "We", "Th", "Fr"], opens: "09:00", closes: "22:30" },
    { days: ["Sa", "Su"], opens: "09:00", closes: "23:00" },
  ],
  hoursNoteEn: "Closed on the 1st and 3rd Monday of every month. Sources disagree on hours, so check before you go.",
  hoursNoteMs: "Tutup pada Isnin pertama dan ketiga setiap bulan. Waktu operasi berbeza mengikut sumber, jadi semak dahulu sebelum datang.",
  highlightsEn: ["3 hours of climbing per ticket", "Gear rental at the counter", "Instructors for first-timers", "Separate kids' room for under-10s", "Open late, until 10:30pm or later"],
  highlightsMs: ["3 jam memanjat untuk setiap tiket", "Sewa peralatan di kaunter", "Jurulatih untuk pemula", "Bilik khas kanak-kanak bawah 10 tahun", "Dibuka hingga lewat malam, 10:30 malam atau lebih"],
  faqEn: [
    { q: "Can children under 10 climb?", a: "Not on the main walls. Children under 10 use the separate kids' room." },
    { q: "I've never climbed before. Can I still come?", a: "Yes, but beginners must climb with an instructor." },
    { q: "When is the park closed?", a: "On the 1st and 3rd Monday of every month." },
    { q: "Do I need my own gear?", a: "No. Rope, harness, shoes, belay device and chalk bag can be rented per session." },
  ],
  faqMs: [
    { q: "Boleh kanak-kanak bawah 10 tahun memanjat?", a: "Tidak di dinding utama. Kanak-kanak bawah 10 tahun menggunakan bilik khas kanak-kanak." },
    { q: "Saya tak pernah panjat dinding. Boleh saya datang?", a: "Boleh, tetapi pemula wajib memanjat bersama jurulatih." },
    { q: "Bila taman ini tutup?", a: "Pada Isnin pertama dan ketiga setiap bulan." },
    { q: "Perlu bawa peralatan sendiri?", a: "Tidak perlu. Tali, abah-abah, kasut, alat belay dan beg kapur boleh disewa untuk setiap sesi." },
  ],
  options: [
    { id: "opt_cp_adult", nameEn: "3-hour entry (adult)", nameMs: "Masuk 3 jam (dewasa)", priceSen: 600, durationMinutes: 180, minAge: 12, needs: { auto_belay_lane: 1 } },
    { id: "opt_cp_child_student", nameEn: "3-hour entry (child 10–11 or student)", nameMs: "Masuk 3 jam (kanak-kanak 10–11 tahun atau pelajar)", priceSen: 300, durationMinutes: 180, minAge: 10, needs: { auto_belay_lane: 1 } },
  ],
  addOns: [
    { id: "addon_cp_rope", nameEn: "Rope rental", nameMs: "Sewa tali", priceSen: 1500 },
    { id: "addon_cp_harness", nameEn: "Harness rental", nameMs: "Sewa abah-abah", priceSen: 500 },
    { id: "addon_cp_shoes", nameEn: "Climbing shoes rental", nameMs: "Sewa kasut panjat", priceSen: 700 },
    { id: "addon_cp_belay", nameEn: "Belay device rental", nameMs: "Sewa alat belay", priceSen: 400 },
    { id: "addon_cp_chalk", nameEn: "Chalk bag rental", nameMs: "Sewa beg kapur", priceSen: 300 },
  ],
  resources: Array.from({ length: 8 }, (_, i) => ({ id: `res_cp_lane_${i + 1}`, kind: "auto_belay_lane" as const, name: `Lane ${i + 1}` })),
  photos: [
    unsplash("1520156557489-31c63271fcd4", "VmYZe_yqxL0", 4000, 6000, "bady abbas", "bady", "Climber in a harness on a top-rope wall", "Pemanjat memakai abah-abah di dinding bertali"),
    unsplash("1571649123442-dc0e1965e037", "h2NlwNkA2h8", 5184, 3456, "Sabrina Wendl", "alightproduction_by_sabrinawendl", "Climber high on a white wall with colourful holds", "Pemanjat di bahagian atas dinding putih dengan pemegang berwarna-warni"),
    unsplash("1564769662533-4f00a87b4056", "NY1D4Zni7fc", 7952, 4888, "Yns Plt", "ynsplt", "Climber reaching across an overhanging wall", "Pemanjat mencapai pemegang di dinding condong"),
    unsplash("1543398971-17eea343659e", "oyPLmauJzzo", 4000, 6000, "Viktor Bystrov", "xokvictor", "Close-up of holds on an orange climbing wall", "Pemegang di dinding panjat berwarna oren dari dekat"),
  ],
};

const SEEDS = [equestrian, challengePark];

const MEMBERS: (typeof members.$inferInsert)[] = [
  { email: "staff@komugo.test", name: "Komugo Staff", role: "staff", operatorId: null },
  { email: "equestrian@komugo.test", name: "Equestrian Park Ops", role: "operator", operatorId: equestrian.operator.id },
  { email: "climbing@komugo.test", name: "Challenge Park Ops", role: "operator", operatorId: challengePark.operator.id },
];

export async function seed(env: Env): Promise<{ options: number; addOns: number }> {
  const db = createDb(env.DB);
  const hub = (table: typeof cities | typeof categories, { photo, ...h }: HubSeed) =>
    db.insert(table).values({ ...h, photoId: photo.id }).onConflictDoUpdate({ target: table.id, set: { ...h, photoId: photo.id } });
  const photo = (p: PhotoSeed, activityId: string | null = null, position = 0) => {
    const v = { ...p, activityId, position };
    return db.insert(photos).values(v).onConflictDoUpdate({ target: photos.id, set: v });
  };

  await db.batch([
    hub(cities, putrajaya),
    photo(putrajaya.photo),
    ...SEEDS.flatMap(({ operator, category, freeCancelHours, closedDays, scheduleId, options, addOns, resources, photos: gallery, ...copy }) => {
      const values = { ...copy, operatorId: operator.id, cityId: putrajaya.id, categoryId: category.id };
      return [
        db.insert(operators).values(operator).onConflictDoUpdate({ target: operators.id, set: operator }),
        hub(categories, category),
        photo(category.photo),
        db.insert(activities).values(values).onConflictDoUpdate({ target: activities.id, set: values }),
        ...gallery.map((p, i) => photo(p, copy.id, i)),
      ];
    }),
    ...MEMBERS.map((m) => db.insert(members).values(m).onConflictDoUpdate({ target: members.email, set: m })),
  ]);

  for (const a of SEEDS) {
    const b = booking(env, a.operator.id);
    await b.upsertActivity({ id: a.id, freeCancelHours: a.freeCancelHours, closedDays: a.closedDays });
    for (const r of a.resources) {
      await b.upsertResource({ active: true, maxSessionsPerDay: null, restMinutes: 0, maxRiderWeightKg: null, ...r });
    }
    for (const { needs, ...o } of a.options) {
      await b.upsertOption({
        minAge: null,
        maxAge: null,
        maxWeightKg: null,
        minParticipants: null,
        requiredCert: null,
        active: true,
        ...o,
        activityId: a.id,
        needs: Object.entries(needs).map(([kind, quantity]) => ({ kind: kind as ResourceKind, quantity })),
      });
    }
    for (const x of a.addOns) await b.upsertAddOn({ ...x, activityId: a.id, active: true });
    await b.upsertSchedule({
      id: a.scheduleId,
      activityId: a.id,
      optionIds: a.options.map((o) => o.id),
      weekdays: WEEKDAYS,
      times: ["09:00", "11:00", "14:00", "16:00"],
      startsOn: klDate(Date.now()),
      endsOn: null,
      active: true,
    });
  }

  const ops = SEEDS.map((a) => a.operator.id);
  const want = { options: SEEDS.flatMap((a) => a.options).length, addOns: SEEDS.flatMap((a) => a.addOns).length };
  let got = { options: 0, addOns: 0 };
  for (let i = 0; i < 40 && (got.options < want.options || got.addOns < want.addOns); i++) {
    if (i) await new Promise((r) => setTimeout(r, 250));
    const [[o], [x]] = await db.batch([
      db.select({ n: count() }).from(projOptions).where(inArray(projOptions.operatorId, ops)),
      db.select({ n: count() }).from(projAddOns).where(inArray(projAddOns.operatorId, ops)),
    ]);
    got = { options: o.n, addOns: x.n };
  }
  return got;
}
