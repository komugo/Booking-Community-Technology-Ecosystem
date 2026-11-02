import { WEEKDAYS, type Weekday } from "@komugo/types/rules";
import { useState } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { api, useApi } from "../api";
import { Group, Input, num, SaveBar, useSubmit } from "../form";
import { errorText, named, useT, type Dict } from "../i18n";
import { useMe } from "../me";
import { MessageSheet } from "../message";
import { rm, sen } from "../money";
import { PhotosEditor } from "../photos";
import type { AddOn, BookingUnit, Contact, ContactRole, ListingMode, Option, PackOffer, Resource, ResourceKind, Setting, Setup, TicketType, Venues } from "../types";
import { Field, Icon, SignedInAs, Sheet, Spinner, Stepper, toast, Toggle } from "../ui";

const TABS = ["activity", "options", "add-ons", "packs", "resources", "contacts"] as const;
type Tab = (typeof TABS)[number];
type ListTab = Exclude<Tab, "activity" | "contacts">;
const KINDS: ResourceKind[] = ["horse", "instructor", "belayer", "auto_belay_lane", "court"];
const PERSON_KINDS = KINDS.filter((k) => k !== "court");
const UNITS: BookingUnit[] = ["person", "court"];
const TICKET_TYPES: TicketType[] = ["timeslot", "date"];
const MODES: ListingMode[] = ["bookable", "info", "hidden"];

const str = (n: number | null) => (n === null ? "" : String(n));

function closedParts(days: string[], t: Dict) {
  return WEEKDAYS.flatMap((d) => {
    const name = t.dayNames[d];
    if (days.includes(d)) return [t.every(name)];
    const ns = days.filter((x) => x.startsWith(`${d}#`)).map((x) => Number(x.slice(3)));
    return ns.length ? [t.nth(ns.sort(), name)] : [];
  });
}

const closedSentence = (days: string[], t: Dict) => (days.length ? t.closedSentence(closedParts(days, t)) : t.openEveryDay);

type Item = Option | AddOn | PackOffer | Resource;

export default function SetupPage() {
  const { t } = useT();
  const { op } = useParams<{ op: string }>();
  const me = useMe()!;
  const [, navigate] = useLocation();
  const tab = (new URLSearchParams(useSearch()).get("tab") ?? "activity") as Tab;
  const setup = useApi<Setup>(`/operators/${op}/setup`);
  const [editing, setEditing] = useState<{ kind: ListTab; item: Item | null } | null>(null);
  const labels: Record<Tab, string> = {
    activity: t.activity,
    options: t.options,
    "add-ons": t.addOns,
    packs: t.packs,
    resources: t.resources,
    contacts: t.contacts,
  };

  if (!setup.data) return setup.error ? <p className="py-16 text-center text-muted">{errorText(setup.error, t)}</p> : <Spinner label={t.loading} />;
  const s = setup.data;
  const done = () => {
    setEditing(null);
    toast(t.saved);
    setup.reload();
  };

  return (
    <>
      <h1 className="text-4xl font-extrabold">{t.setup}</h1>
      <div role="tablist" aria-label={t.setup} className="mt-5 flex gap-1 overflow-x-auto rounded-full bg-sand p-1">
        {TABS.map((x) => (
          <button
            key={x}
            role="tab"
            type="button"
            aria-selected={x === tab}
            onClick={() => navigate(`/o/${op}/setup?tab=${x}`, { replace: true })}
            className={`min-h-11 flex-1 rounded-full px-3 text-sm font-semibold whitespace-nowrap ${x === tab ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {labels[x]}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={labels[tab]} className="mt-5">
        {tab === "activity" && me.member.role === "staff" && <CommissionCard op={op} setup={s} onSaved={setup.reload} />}
        {tab === "activity" && me.member.role === "staff" && <HolidaysCard op={op} setup={s} onSaved={setup.reload} />}
        {tab === "activity" &&
          s.catalogue.map((a) => <ActivityCard key={a.id} op={op} setup={s} id={a.id} staff={me.member.role === "staff"} onSaved={setup.reload} />)}
        {tab === "contacts" && <Contacts op={op} />}
        {tab !== "activity" && tab !== "contacts" && (
          <List setup={s} kind={tab} onNew={() => setEditing({ kind: tab, item: null })} onEdit={(item) => setEditing({ kind: tab, item })} />
        )}
      </div>

      <SignedInAs me={me} />

      <Sheet
        open={!!editing}
        onClose={() => setEditing(null)}
        full
        title={
          !editing
            ? ""
            : editing.kind === "options"
              ? editing.item
                ? t.editOption
                : t.newOption
              : editing.kind === "add-ons"
                ? editing.item
                  ? t.editAddOn
                  : t.newAddOn
                : editing.kind === "packs"
                  ? editing.item
                    ? t.editPackOffer
                    : t.newPackOffer
                  : editing.item
                    ? t.editResource
                    : t.newResource
        }
      >
        {editing?.kind === "options" && <OptionEditor op={op} setup={s} item={editing.item as Option | null} onSaved={done} />}
        {editing?.kind === "add-ons" && <AddOnEditor op={op} setup={s} item={editing.item as AddOn | null} onSaved={done} />}
        {editing?.kind === "packs" && <PackOfferEditor op={op} setup={s} item={editing.item as PackOffer | null} onSaved={done} />}
        {editing?.kind === "resources" && <ResourceEditor op={op} item={editing.item as Resource | null} onSaved={done} />}
      </Sheet>
    </>
  );
}

function List({
  setup,
  kind,
  onNew,
  onEdit,
}: {
  setup: Setup;
  kind: ListTab;
  onNew: () => void;
  onEdit: (x: Item) => void;
}) {
  const { t, l } = useT();
  const optionNames = (ids: string[]) =>
    setup.options
      .filter((o) => ids.includes(o.id))
      .map((o) => named(o, l))
      .join(", ");
  const rows: { item: Item; title: string; detail: string; sub?: string }[] =
    kind === "options"
      ? setup.options.map((o) => ({
          item: o,
          title: named(o, l),
          detail: [
            rm(o.priceSen),
            ...(o.weekendPriceSen === null ? [] : [`${t.weekend} ${rm(o.weekendPriceSen)}`]),
            `${o.durationMinutes} ${t.min}`,
            ...o.needs.map((n) => `${n.quantity}× ${t.kinds[n.kind]}`),
          ].join(" · "),
        }))
      : kind === "add-ons"
        ? setup.addOns.map((a) => ({ item: a, title: named(a, l), detail: rm(a.priceSen) }))
        : kind === "packs"
          ? setup.packOffers.map((p) => ({
              item: p,
              title: named(p, l),
              detail: t.packRow(p.sessions, rm(p.priceSen), p.validDays),
              sub: optionNames(p.optionIds),
            }))
          : setup.resources.map((r) => ({
            item: r,
            title: r.name,
            detail:
              r.kind === "horse"
                ? [
                    r.maxRiderWeightKg !== null && `≤${r.maxRiderWeightKg} kg`,
                    r.maxSessionsPerDay !== null && t.perDay(r.maxSessionsPerDay),
                    t.restShort(r.restMinutes),
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : t.kinds[r.kind],
          }));
  const add = { options: t.newOption, "add-ons": t.newAddOn, packs: t.newPackOffer, resources: t.newResource }[kind];
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={onNew}>
        <Icon name="plus" className="size-5" />
        {add}
      </button>
      <ul className="mt-4 grid gap-3 lg:grid-cols-2">
        {rows.map((r) => (
          <li key={r.item.id}>
            <button
              type="button"
              onClick={() => onEdit(r.item)}
              data-row
              className={`card flex min-h-16 w-full items-center justify-between gap-3 p-4 text-left hover:bg-sand/40 ${r.item.active ? "" : "opacity-60"}`}
            >
              <span className="min-w-0">
                <span className="block font-display text-lg font-bold">{r.title}</span>
                <span className="num block text-sm text-muted">{r.detail}</span>
                {r.sub && <span className="block text-sm">{r.sub}</span>}
              </span>
              {!r.item.active && <span className="shrink-0 rounded-full bg-sand px-2.5 py-0.5 text-xs font-semibold">{t.inactive}</span>}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Contacts({ op }: { op: string }) {
  const { t } = useT();
  const list = useApi<{ contacts: Contact[] }>(`/operators/${op}/contacts`);
  const [editing, setEditing] = useState<{ item: Contact | null } | null>(null);
  const [messaging, setMessaging] = useState(false);
  const done = () => {
    setEditing(null);
    toast(t.saved);
    list.reload();
  };

  if (!list.data) return list.error ? <p className="py-16 text-center text-muted">{errorText(list.error, t)}</p> : <Spinner label={t.loading} />;
  return (
    <>
      <p className="mb-4 text-muted">{t.contactsHint}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ item: null })}>
          <Icon name="plus" className="size-5" />
          {t.newContact}
        </button>
        {list.data.contacts.length > 0 && (
          <button type="button" className="btn btn-quiet" onClick={() => setMessaging(true)}>
            {t.messageContacts}
          </button>
        )}
      </div>
      {list.data.contacts.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-sand p-4">{t.noContacts}</p>
      ) : (
        <ul className="mt-4 grid gap-3 lg:grid-cols-2" aria-label={t.contacts}>
          {list.data.contacts.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setEditing({ item: c })}
                data-row
                className="card flex min-h-16 w-full items-center justify-between gap-3 p-4 text-left hover:bg-sand/40"
              >
                <span className="min-w-0">
                  <span className="block font-display text-lg font-bold">{c.name}</span>
                  <span className="num block text-sm text-muted">
                    {[c.phone, t.contactRoles[c.role], t.contactLanguages[c.locale], ...(c.email ? [c.email] : [])].join(" · ")}
                  </span>
                </span>
                {c.welcome && (
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.welcome.status === "sent" ? "bg-lime text-forest" : "bg-sand text-clay"}`}>
                    {t.welcomeStatus[c.welcome.status]}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={!!editing} onClose={() => setEditing(null)} full title={editing?.item ? t.editContact : t.newContact}>
        {editing && <ContactEditor op={op} item={editing.item} onSaved={done} />}
      </Sheet>
      <MessageSheet op={op} open={messaging} onClose={() => setMessaging(false)} />
    </>
  );
}

function ContactEditor({ op, item, onSaved }: { op: string; item: Contact | null; onSaved: () => void }) {
  const { t } = useT();
  const [v, setV] = useState({
    name: item?.name ?? "",
    phone: item?.phone ?? "",
    role: item?.role ?? ("counter" as ContactRole),
    locale: item?.locale ?? ("ms" as Contact["locale"]),
    email: item?.email ?? "",
  });
  const set = (p: Partial<typeof v>) => setV({ ...v, ...p });
  const { busy, error, submit, err } = useSubmit(t);
  const path = `/operators/${op}/contacts${item ? `/${item.id}` : ""}`;

  const save = async () => {
    if (await submit(() => api(item ? "PUT" : "POST", path, v))) onSaved();
  };
  const remove = async () => {
    if (await submit(() => api("POST", `${path}/remove`, {}))) onSaved();
  };

  return (
    <div className="space-y-4">
      <Input label={t.name} value={v.name} onChange={(name) => set({ name })} error={err("name")} />
      <Input label={t.whatsappNumber} value={v.phone} onChange={(phone) => set({ phone })} error={err("phone")} hint={t.whatsappNumberHint} />
      <Field label={t.contactRole} hint={t.contactRoleHint} error={err("role")}>
        {(id, note) => (
          <select id={id} className="input" value={v.role} aria-describedby={note} onChange={(e) => set({ role: e.target.value as ContactRole })}>
            {(["counter", "owner"] as const).map((r) => (
              <option key={r} value={r}>
                {t.contactRoles[r]}
              </option>
            ))}
          </select>
        )}
      </Field>
      {v.role === "owner" && <Input label={t.ownerEmail} value={v.email} onChange={(email) => set({ email })} error={err("email")} />}
      <Field label={t.contactLanguage} error={err("locale")}>
        {(id, note) => (
          <select id={id} className="input" value={v.locale} aria-describedby={note} onChange={(e) => set({ locale: e.target.value as Contact["locale"] })}>
            {(["ms", "en"] as const).map((l) => (
              <option key={l} value={l}>
                {t.contactLanguages[l]}
              </option>
            ))}
          </select>
        )}
      </Field>
      {item && (
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={remove}>
          {t.removeContact}
        </button>
      )}
      <SaveBar busy={busy} error={error} onSave={save} />
    </div>
  );
}

function CommissionCard({ op, setup, onSaved }: { op: string; setup: Setup; onSaved: () => void }) {
  const { t } = useT();
  const [pct, setPct] = useState(setup.commissionBps === null ? "" : String(setup.commissionBps / 100));
  const { busy, error, submit, err } = useSubmit(t);
  const save = async () => {
    // sen() multiplies by 100, which also turns a percentage into basis points.
    if (await submit(() => api("PUT", `/operators/${op}/commission`, { commissionBps: sen(pct) }))) {
      toast(t.saved);
      onSaved();
    }
  };
  return (
    <section className="card mb-4 space-y-4 p-4" aria-label={t.commission}>
      <Input label={t.commissionPct} value={pct} onChange={setPct} error={err("commissionBps") ?? error?.text} hint={t.commissionHint} numeric />
      <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={busy} onClick={save}>
        {t.save}
      </button>
    </section>
  );
}

function HolidaysCard({ op, setup, onSaved }: { op: string; setup: Setup; onSaved: () => void }) {
  const { t } = useT();
  const { error, submit } = useSubmit(t);
  const save = async (holidaysAsWeekend: boolean) => {
    if (await submit(() => api("PUT", `/operators/${op}/holidays-as-weekend`, { holidaysAsWeekend }))) {
      toast(t.saved);
      onSaved();
    }
  };
  return (
    <section className="card mb-4 p-4" aria-label={t.holidaysAsWeekend}>
      <Toggle label={t.holidaysAsWeekend} checked={setup.holidaysAsWeekend} onChange={save} />
      <p className="text-sm text-muted">{error?.text ?? t.holidaysAsWeekendHint}</p>
    </section>
  );
}

function ActivityCard({ op, setup, id, staff, onSaved }: { op: string; setup: Setup; id: string; staff: boolean; onSaved: () => void }) {
  const { t, l } = useT();
  const a = setup.catalogue.find((x) => x.id === id)!;
  const settings = setup.activities.find((x) => x.id === id) ?? {
    freeCancelHours: 0,
    bookingCutoffMinutes: 60,
    closedDays: [],
    requiresWaiver: true,
    maxCourtTickets: 2,
  };
  const courts = setup.options.some((o) => o.activityId === id && o.bookingUnit === "court");
  const [hours, setHours] = useState(String(settings.freeCancelHours));
  const [cutoff, setCutoff] = useState(String(settings.bookingCutoffMinutes));
  const [closed, setClosed] = useState<string[]>(settings.closedDays);
  const [waiver, setWaiver] = useState(settings.requiresWaiver);
  const [maxCourts, setMaxCourts] = useState(String(settings.maxCourtTickets));
  const [pick, setPick] = useState<{ day: Weekday; nth: string }>({ day: "Mo", nth: "" });
  const [mode, setMode] = useState(a.listingMode);
  const [editingPage, setEditingPage] = useState(false);
  const { busy, error, submit, err } = useSubmit(t);
  const rule = pick.nth ? `${pick.day}#${pick.nth}` : pick.day;

  const save = async () => {
    const ok = await submit(() =>
      api("PUT", `/operators/${op}/activities/${id}`, {
        freeCancelHours: num(hours),
        bookingCutoffMinutes: num(cutoff),
        closedDays: closed,
        requiresWaiver: waiver,
        maxCourtTickets: num(maxCourts),
      }),
    );
    if (ok) {
      toast(t.saved);
      onSaved();
    }
  };
  const changeMode = async (v: ListingMode) => {
    const was = mode;
    setMode(v);
    if (!(await submit(() => api("PUT", `/operators/${op}/activities/${id}/listing-mode`, { listingMode: v })))) setMode(was);
  };

  return (
    <section className="card mb-4 space-y-5 p-4" aria-labelledby={`act-${id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id={`act-${id}`} className="text-2xl font-extrabold">
          {named(a, l)}
        </h2>
        {!staff && (
          <span data-listing-mode={mode} className={`rounded-full px-3 py-1 text-sm font-semibold ${mode === "bookable" ? "bg-lime text-forest" : "bg-sand"}`}>
            {t.listingModes[mode]}
          </span>
        )}
      </div>
      {staff && (
        <Field label={t.listingMode} hint={t.listingModeHint} error={err("listingMode")}>
          {(fid, note) => (
            <select id={fid} className="input" value={mode} aria-describedby={note} onChange={(e) => changeMode(e.target.value as ListingMode)}>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {t.listingModes[m]}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <button type="button" className="btn btn-quiet" onClick={() => setEditingPage(true)}>
        {t.editPage}
      </button>
      <Sheet open={editingPage} onClose={() => setEditingPage(false)} full title={t.activityPage}>
        <CopyEditor
          op={op}
          activity={a}
          staff={staff}
          onSaved={() => {
            setEditingPage(false);
            toast(t.saved);
            onSaved();
          }}
        />
      </Sheet>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.freeCancelHours} error={err("freeCancelHours")}>
          {(fid, note) => (
            <input
              id={fid}
              className="input num"
              inputMode="numeric"
              value={hours}
              aria-describedby={note}
              aria-invalid={!!err("freeCancelHours") || undefined}
              onChange={(e) => setHours(e.target.value)}
            />
          )}
        </Field>
        <Field label={t.bookingCutoff} error={err("bookingCutoffMinutes")}>
          {(fid, note) => (
            <input
              id={fid}
              className="input num"
              inputMode="numeric"
              value={cutoff}
              aria-describedby={note}
              aria-invalid={!!err("bookingCutoffMinutes") || undefined}
              onChange={(e) => setCutoff(e.target.value)}
            />
          )}
        </Field>
      </div>
      {courts && (
        <Input label={t.maxCourtTickets} value={maxCourts} onChange={setMaxCourts} error={err("maxCourtTickets")} hint={t.maxCourtTicketsHint} numeric />
      )}
      <Toggle label={t.requiresWaiver} checked={waiver} onChange={setWaiver} />
      <fieldset>
        <legend className="label">{t.closedDays}</legend>
        <p className="font-display text-xl font-bold" data-closed-sentence>
          {closedSentence(closed, t)}
        </p>
        {closed.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {closed.map((c) => (
              <li key={c}>
                <button
                  type="button"
                  className="chip gap-1.5"
                  aria-label={t.removeClosedDay(closedParts([c], t)[0])}
                  onClick={() => setClosed(closed.filter((x) => x !== c))}
                >
                  {closedParts([c], t)[0]}
                  <Icon name="x" className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <select
            aria-label={t.days}
            className="input w-auto"
            value={pick.day}
            onChange={(e) => setPick({ ...pick, day: e.target.value as Weekday })}
          >
            {WEEKDAYS.map((d) => (
              <option key={d} value={d}>
                {t.dayNames[d]}
              </option>
            ))}
          </select>
          <select aria-label={t.closedDays} className="input w-auto" value={pick.nth} onChange={(e) => setPick({ ...pick, nth: e.target.value })}>
            <option value="">{t.everyWeek}</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {t.nthOfMonth(n)}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-quiet" disabled={closed.includes(rule)} onClick={() => setClosed([...closed, rule])}>
            {t.addClosedDay}
          </button>
        </div>
        {err("closedDays") && <p className="mt-1 text-sm font-semibold text-clay">{err("closedDays")}</p>}
      </fieldset>
      {error && !error.field && (
        <p role="alert" className="font-semibold text-clay">
          {error.text}
        </p>
      )}
      <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={busy} onClick={save}>
        {t.save}
      </button>
    </section>
  );
}

function CopyEditor({ op, activity, staff, onSaved }: { op: string; activity: Setup["catalogue"][number]; staff: boolean; onSaved: () => void }) {
  const { t } = useT();
  const [v, setV] = useState({
    descriptionEn: activity.descriptionEn,
    descriptionMs: activity.descriptionMs,
    venueId: activity.venueId,
    free: activity.free,
    setting: activity.setting,
    photos: activity.photos,
  });
  const { busy, error, submit, err } = useSubmit(t);
  const save = async () => {
    if (await submit(() => api("PUT", `/operators/${op}/activities/${activity.id}/copy`, v))) onSaved();
  };
  return (
    <div className="space-y-6">
      {staff && <VenueSelect value={v.venueId} onChange={(venueId) => setV({ ...v, venueId })} error={err("venueId")} />}
      {(["descriptionEn", "descriptionMs"] as const).map((k) => (
        <Field key={k} label={t[k]} error={err(k)}>
          {(id, note) => (
            <textarea
              id={id}
              rows={6}
              className="input min-h-36 py-3"
              value={v[k]}
              aria-describedby={note}
              aria-invalid={!!err(k) || undefined}
              onChange={(e) => setV({ ...v, [k]: e.target.value })}
            />
          )}
        </Field>
      ))}
      <PhotosEditor photos={v.photos} onChange={(fn) => setV((x) => ({ ...x, photos: fn(x.photos) }))} error={err("photos")} />
      <Toggle label={t.free} checked={v.free} onChange={(free) => setV({ ...v, free })} />
      <Field label={t.setting} error={err("setting")}>
        {(id, note) => (
          <select
            id={id}
            className="input"
            value={v.setting ?? ""}
            aria-describedby={note}
            onChange={(e) => setV({ ...v, setting: (e.target.value || null) as Setting | null })}
          >
            <option value="">{t.settingUnset}</option>
            {(["indoor", "outdoor"] as const).map((s) => (
              <option key={s} value={s}>
                {t.settings[s]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <SaveBar busy={busy} error={error} onSave={save} />
    </div>
  );
}

function VenueSelect({ value, onChange, error }: { value: string | null; onChange: (v: string | null) => void; error?: string }) {
  const { t, l } = useT();
  const list = useApi<Venues>("/venues");
  return (
    <Field label={t.venue} error={error}>
      {(id, note) => (
        <select id={id} className="input" value={value ?? ""} aria-describedby={note} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">{t.noVenue}</option>
          {list.data?.venues.map((x) => (
            <option key={x.id} value={x.id}>
              {named(x, l)}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

function ActivitySelect({ setup, value, onChange }: { setup: Setup; value: string; onChange: (v: string) => void }) {
  const { t, l } = useT();
  if (setup.catalogue.length < 2) return null;
  return (
    <Field label={t.activity}>
      {(id) => (
        <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
          {setup.catalogue.map((a) => (
            <option key={a.id} value={a.id}>
              {named(a, l)}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

function OptionEditor({ op, setup, item, onSaved }: { op: string; setup: Setup; item: Option | null; onSaved: () => void }) {
  const { t } = useT();
  const [v, setV] = useState({
    activityId: item?.activityId ?? setup.catalogue[0]?.id ?? "",
    nameEn: item?.nameEn ?? "",
    nameMs: item?.nameMs ?? "",
    price: item ? String(item.priceSen / 100) : "",
    duration: str(item?.durationMinutes ?? 60),
    minAge: str(item?.minAge ?? null),
    maxAge: str(item?.maxAge ?? null),
    maxWeightKg: str(item?.maxWeightKg ?? null),
    requiredCert: item?.requiredCert ?? "",
    minParticipants: item?.minParticipants ?? 1,
    maxPerBooking: item?.maxPerBooking ?? 10,
    bookingUnit: item?.bookingUnit ?? ("person" as BookingUnit),
    ticketType: item?.ticketType ?? ("timeslot" as TicketType),
    dailyLimit: str(item?.dailyLimit ?? null),
    weekendPrice: item?.weekendPriceSen == null ? "" : String(item.weekendPriceSen / 100),
    active: item?.active ?? true,
    needs: Object.fromEntries(PERSON_KINDS.map((k) => [k, item?.needs.find((n) => n.kind === k)?.quantity ?? 0])) as Record<ResourceKind, number>,
  });
  const set = (p: Partial<typeof v>) => setV({ ...v, ...p });
  const { busy, error, submit, err } = useSubmit(t);
  const court = v.bookingUnit === "court";
  const dated = v.ticketType === "date";

  const save = async () => {
    const body = {
      activityId: v.activityId,
      nameEn: v.nameEn,
      nameMs: v.nameMs,
      priceSen: sen(v.price),
      bookingUnit: v.bookingUnit,
      ticketType: v.ticketType,
      dailyLimit: dated ? num(v.dailyLimit) : null,
      weekendPriceSen: dated ? sen(v.weekendPrice) : null,
      active: v.active,
      ...(court
        ? {
            durationMinutes: 60,
            minAge: null,
            maxAge: null,
            maxWeightKg: null,
            requiredCert: null,
            minParticipants: null,
            maxPerBooking: null,
            needs: [{ kind: "court", quantity: 1 }],
          }
        : {
            durationMinutes: dated ? 60 : num(v.duration),
            minAge: num(v.minAge),
            maxAge: num(v.maxAge),
            maxWeightKg: num(v.maxWeightKg),
            requiredCert: v.requiredCert.trim() || null,
            minParticipants: v.minParticipants > 1 ? v.minParticipants : null,
            maxPerBooking: v.maxPerBooking !== 10 ? v.maxPerBooking : null,
            needs: dated ? [] : PERSON_KINDS.filter((k) => v.needs[k] > 0).map((k) => ({ kind: k, quantity: v.needs[k] })),
          }),
    };
    if (await submit(() => api(item ? "PUT" : "POST", `/operators/${op}/options${item ? `/${item.id}` : ""}`, body), t.lengthenBlocked)) onSaved();
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <ActivitySelect setup={setup} value={v.activityId} onChange={(activityId) => set({ activityId })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t.nameEn} value={v.nameEn} onChange={(nameEn) => set({ nameEn })} error={err("nameEn")} />
          <Input label={t.nameMs} value={v.nameMs} onChange={(nameMs) => set({ nameMs })} error={err("nameMs")} />
        </div>
        <Field label={t.ticketType} hint={dated ? t.dateHint : undefined}>
          {(id, note) => (
            <select
              id={id}
              className="input"
              value={v.ticketType}
              disabled={!!item}
              aria-describedby={note}
              onChange={(e) => set({ ticketType: e.target.value as TicketType, bookingUnit: "person" })}
            >
              {TICKET_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t.ticketTypes[x]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {!dated && (
          <Field label={t.bookingUnit} hint={court ? t.courtHint : undefined}>
            {(id, note) => (
              <select
                id={id}
                className="input"
                value={v.bookingUnit}
                disabled={!!item}
                aria-describedby={note}
                onChange={(e) => set({ bookingUnit: e.target.value as BookingUnit })}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {t.bookingUnits[u]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Input label={t.priceRm} value={v.price} onChange={(price) => set({ price })} error={err("priceSen")} numeric />
          {dated ? (
            <Input label={t.dailyLimit} value={v.dailyLimit} onChange={(dailyLimit) => set({ dailyLimit })} error={err("dailyLimit")} hint={t.dailyLimitHint} numeric />
          ) : (
            !court && <Input label={t.duration} value={v.duration} onChange={(duration) => set({ duration })} error={err("durationMinutes")} numeric />
          )}
          {dated && (
            <Input
              label={t.weekendPriceRm}
              value={v.weekendPrice}
              onChange={(weekendPrice) => set({ weekendPrice })}
              error={err("weekendPriceSen")}
              hint={t.weekendPriceHint}
              numeric
            />
          )}
        </div>
      </div>
      {!court && (
        <>
          <Group title={t.requirements}>
            <div className="grid grid-cols-2 gap-4">
              <Input label={t.minAge} value={v.minAge} onChange={(minAge) => set({ minAge })} error={err("minAge")} hint={t.optional} numeric />
              <Input label={t.maxAge} value={v.maxAge} onChange={(maxAge) => set({ maxAge })} error={err("maxAge")} hint={t.optional} numeric />
              <Input
                label={t.maxWeight}
                value={v.maxWeightKg}
                onChange={(maxWeightKg) => set({ maxWeightKg })}
                error={err("maxWeightKg")}
                hint={t.optional}
                numeric
              />
              <Input
                label={t.cert}
                value={v.requiredCert}
                onChange={(requiredCert) => set({ requiredCert })}
                error={err("requiredCert")}
                hint={t.optional}
              />
            </div>
            <Stepper label={t.minParticipants} value={v.minParticipants} min={1} max={10} onChange={(minParticipants) => set({ minParticipants })} />
            <Stepper label={t.maxPerBooking} value={v.maxPerBooking} min={v.minParticipants} max={50} onChange={(maxPerBooking) => set({ maxPerBooking })} />
            {err("maxPerBooking") && <p className="text-sm font-semibold text-clay">{err("maxPerBooking")}</p>}
          </Group>
          {!dated && (
            <Group title={t.resourceNeeds}>
              {PERSON_KINDS.map((k) => (
                <Stepper key={k} label={t.kinds[k]} value={v.needs[k]} min={0} max={10} onChange={(n) => set({ needs: { ...v.needs, [k]: n } })} />
              ))}
              {err("needs") && <p className="text-sm font-semibold text-clay">{err("needs")}</p>}
            </Group>
          )}
        </>
      )}
      <Toggle label={t.active} checked={v.active} onChange={(active) => set({ active })} />
      <SaveBar busy={busy} error={error} onSave={save} />
    </div>
  );
}

function AddOnEditor({ op, setup, item, onSaved }: { op: string; setup: Setup; item: AddOn | null; onSaved: () => void }) {
  const { t } = useT();
  const [v, setV] = useState({
    activityId: item?.activityId ?? setup.catalogue[0]?.id ?? "",
    nameEn: item?.nameEn ?? "",
    nameMs: item?.nameMs ?? "",
    price: item ? String(item.priceSen / 100) : "",
    active: item?.active ?? true,
  });
  const set = (p: Partial<typeof v>) => setV({ ...v, ...p });
  const { busy, error, submit, err } = useSubmit(t);

  const save = async () => {
    const body = { activityId: v.activityId, nameEn: v.nameEn, nameMs: v.nameMs, priceSen: sen(v.price), active: v.active };
    if (await submit(() => api(item ? "PUT" : "POST", `/operators/${op}/add-ons${item ? `/${item.id}` : ""}`, body))) onSaved();
  };

  return (
    <div className="space-y-4">
      <ActivitySelect setup={setup} value={v.activityId} onChange={(activityId) => set({ activityId })} />
      <Input label={t.nameEn} value={v.nameEn} onChange={(nameEn) => set({ nameEn })} error={err("nameEn")} />
      <Input label={t.nameMs} value={v.nameMs} onChange={(nameMs) => set({ nameMs })} error={err("nameMs")} />
      <Input label={t.priceRm} value={v.price} onChange={(price) => set({ price })} error={err("priceSen")} numeric />
      <Toggle label={t.active} checked={v.active} onChange={(active) => set({ active })} />
      <SaveBar busy={busy} error={error} onSave={save} />
    </div>
  );
}

function ResourceEditor({ op, item, onSaved }: { op: string; item: Resource | null; onSaved: () => void }) {
  const { t } = useT();
  const [v, setV] = useState({
    kind: item?.kind ?? ("horse" as ResourceKind),
    name: item?.name ?? "",
    active: item?.active ?? true,
    maxSessionsPerDay: str(item?.maxSessionsPerDay ?? null),
    restMinutes: str(item?.restMinutes ?? 15),
    maxRiderWeightKg: str(item?.maxRiderWeightKg ?? null),
  });
  const set = (p: Partial<typeof v>) => setV({ ...v, ...p });
  const { busy, error, submit, err } = useSubmit(t);
  const horse = v.kind === "horse";

  const save = async () => {
    const body = {
      kind: v.kind,
      name: v.name,
      active: v.active,
      maxSessionsPerDay: horse ? num(v.maxSessionsPerDay) : null,
      restMinutes: horse ? (num(v.restMinutes) ?? 0) : 0,
      maxRiderWeightKg: horse ? num(v.maxRiderWeightKg) : null,
    };
    if (await submit(() => api(item ? "PUT" : "POST", `/operators/${op}/resources${item ? `/${item.id}` : ""}`, body))) onSaved();
  };

  return (
    <div className="space-y-4">
      <Field label={t.kind}>
        {(id) => (
          <select id={id} className="input" value={v.kind} disabled={!!item} onChange={(e) => set({ kind: e.target.value as ResourceKind })}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t.kinds[k]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Input label={t.name} value={v.name} onChange={(name) => set({ name })} error={err("name")} />
      {horse && (
        <div className="rounded-2xl bg-sand/60 p-4">
          <Group title={t.welfare}>
            <Input
              label={t.maxSessions}
              value={v.maxSessionsPerDay}
              onChange={(maxSessionsPerDay) => set({ maxSessionsPerDay })}
              error={err("maxSessionsPerDay")}
              hint={t.maxSessionsHint}
              numeric
            />
            <Input
              label={t.rest}
              value={v.restMinutes}
              onChange={(restMinutes) => set({ restMinutes })}
              error={err("restMinutes")}
              hint={t.restHint}
              numeric
            />
            <Input
              label={t.maxRider}
              value={v.maxRiderWeightKg}
              onChange={(maxRiderWeightKg) => set({ maxRiderWeightKg })}
              error={err("maxRiderWeightKg")}
              hint={t.maxRiderHint}
              numeric
            />
          </Group>
        </div>
      )}
      <Toggle label={t.active} checked={v.active} onChange={(active) => set({ active })} />
      {item && <p className="text-sm text-muted">{t.deactivateHint}</p>}
      <SaveBar busy={busy} error={error} onSave={save} />
    </div>
  );
}

const DAY_CHIPS = [30, 90, 180, 365];

function PackOfferEditor({ op, setup, item, onSaved }: { op: string; setup: Setup; item: PackOffer | null; onSaved: () => void }) {
  const { t, l } = useT();
  const [v, setV] = useState({
    activityId: item?.activityId ?? setup.catalogue[0]?.id ?? "",
    nameEn: item?.nameEn ?? "",
    nameMs: item?.nameMs ?? "",
    sessions: item?.sessions ?? 4,
    price: item ? String(item.priceSen / 100) : "",
    validDays: str(item?.validDays ?? 90),
    optionIds: item?.optionIds ?? [],
    active: item?.active ?? true,
  });
  const set = (p: Partial<typeof v>) => setV({ ...v, ...p });
  const { busy, error, submit, err } = useSubmit(t);
  const options = setup.options.filter((o) => o.activityId === v.activityId && o.bookingUnit === "person" && o.ticketType === "timeslot");

  const save = async () => {
    const body = {
      activityId: v.activityId,
      nameEn: v.nameEn,
      nameMs: v.nameMs,
      sessions: v.sessions,
      priceSen: sen(v.price),
      validDays: num(v.validDays),
      optionIds: v.optionIds,
      active: v.active,
    };
    if (await submit(() => api(item ? "PUT" : "POST", `/operators/${op}/pack-offers${item ? `/${item.id}` : ""}`, body))) onSaved();
  };

  return (
    <div className="space-y-6">
      <ActivitySelect setup={setup} value={v.activityId} onChange={(activityId) => set({ activityId, optionIds: [] })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t.nameEn} value={v.nameEn} onChange={(nameEn) => set({ nameEn })} error={err("nameEn")} />
        <Input label={t.nameMs} value={v.nameMs} onChange={(nameMs) => set({ nameMs })} error={err("nameMs")} />
      </div>
      <Stepper label={t.sessions} value={v.sessions} min={1} max={50} onChange={(sessions) => set({ sessions })} />
      <Input label={t.priceRm} value={v.price} onChange={(price) => set({ price })} error={err("priceSen")} numeric />
      <div>
        <Input label={t.validDays} value={v.validDays} onChange={(validDays) => set({ validDays })} error={err("validDays")} numeric />
        <div className="mt-2 flex flex-wrap gap-2">
          {DAY_CHIPS.map((d) => (
            <button key={d} type="button" className="chip num" aria-pressed={v.validDays === String(d)} onClick={() => set({ validDays: String(d) })}>
              {d}
            </button>
          ))}
        </div>
      </div>
      <fieldset aria-describedby="eligible-note">
        <legend className="label">{t.eligibleOptions}</legend>
        <div className="space-y-2">
          {options.map((o) => (
            <label key={o.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line bg-white px-3 has-checked:border-forest">
              <input
                type="checkbox"
                className="size-5 accent-leaf"
                checked={v.optionIds.includes(o.id)}
                onChange={(e) => set({ optionIds: e.target.checked ? [...v.optionIds, o.id] : v.optionIds.filter((x) => x !== o.id) })}
              />
              <span className="font-semibold">{named(o, l)}</span>
              <span className="num ml-auto text-sm text-muted">{rm(o.priceSen)}</span>
            </label>
          ))}
        </div>
        <p id="eligible-note" className={`mt-1 text-sm ${err("optionIds") ? "font-semibold text-clay" : "text-muted"}`}>
          {err("optionIds") ?? t.eligibleHint}
        </p>
      </fieldset>
      <Toggle label={t.active} checked={v.active} onChange={(active) => set({ active })} />
      {item && <p className="text-sm text-muted">{t.packHint}</p>}
      <SaveBar busy={busy} error={error} onSave={save} />
    </div>
  );
}
