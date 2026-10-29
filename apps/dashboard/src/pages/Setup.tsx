import { WEEKDAYS, type Weekday } from "@komugo/types/rules";
import { useState, type ReactNode } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { api, ApiError, useApi } from "../api";
import { errorText, named, useT, type Dict } from "../i18n";
import { useMe } from "../me";
import type { AddOn, ListingMode, Option, PackOffer, Resource, ResourceKind, Setup } from "../types";
import { Field, Icon, SignedInAs, Sheet, Spinner, Stepper, toast, Toggle } from "../ui";

const TABS = ["activity", "options", "add-ons", "packs", "resources"] as const;
type Tab = (typeof TABS)[number];
const KINDS: ResourceKind[] = ["horse", "instructor", "belayer", "auto_belay_lane"];
const MODES: ListingMode[] = ["bookable", "info", "hidden"];

const rm = (sen: number) => `RM${sen % 100 ? (sen / 100).toFixed(2) : sen / 100}`;
const str = (n: number | null) => (n === null ? "" : String(n));
// An unparseable value is sent as typed so the API rejects it on the right field.
const num = (s: string) => (s.trim() === "" ? null : Number.isFinite(Number(s)) ? Number(s) : s);
const sen = (s: string) => (s.trim() === "" ? null : Number.isFinite(Number(s)) ? Math.round(Number(s) * 100) : s);

function closedParts(days: string[], t: Dict) {
  return WEEKDAYS.flatMap((d) => {
    const name = t.dayNames[d];
    if (days.includes(d)) return [t.every(name)];
    const ns = days.filter((x) => x.startsWith(`${d}#`)).map((x) => Number(x.slice(3)));
    return ns.length ? [t.nth(ns.sort(), name)] : [];
  });
}

const closedSentence = (days: string[], t: Dict) => (days.length ? t.closedSentence(closedParts(days, t)) : t.openEveryDay);

type Err = { field?: string; text: string } | null;
type Item = Option | AddOn | PackOffer | Resource;

function useSubmit(t: Dict) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Err>(null);
  async function submit(fn: () => Promise<unknown>, onConflict?: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError({ field: (e as ApiError).field, text: onConflict && e instanceof ApiError && e.status === 409 ? onConflict : errorText(e, t) });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, submit, err: (f: string) => (error?.field === f ? error.text : undefined) };
}

export default function SetupPage() {
  const { t } = useT();
  const { op } = useParams<{ op: string }>();
  const me = useMe()!;
  const [, navigate] = useLocation();
  const tab = (new URLSearchParams(useSearch()).get("tab") ?? "activity") as Tab;
  const setup = useApi<Setup>(`/operators/${op}/setup`);
  const [editing, setEditing] = useState<{ kind: Exclude<Tab, "activity">; item: Item | null } | null>(null);
  const labels: Record<Tab, string> = { activity: t.activity, options: t.options, "add-ons": t.addOns, packs: t.packs, resources: t.resources };

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
        {tab === "activity" &&
          s.catalogue.map((a) => <ActivityCard key={a.id} op={op} setup={s} id={a.id} staff={me.member.role === "staff"} onSaved={setup.reload} />)}
        {tab !== "activity" && (
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
  kind: Exclude<Tab, "activity">;
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
          detail: [rm(o.priceSen), `${o.durationMinutes} ${t.min}`, ...o.needs.map((n) => `${n.quantity}× ${t.kinds[n.kind]}`)].join(" · "),
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

function ActivityCard({ op, setup, id, staff, onSaved }: { op: string; setup: Setup; id: string; staff: boolean; onSaved: () => void }) {
  const { t, l } = useT();
  const a = setup.catalogue.find((x) => x.id === id)!;
  const settings = setup.activities.find((x) => x.id === id) ?? { freeCancelHours: 24, bookingCutoffMinutes: 60, closedDays: [], requiresWaiver: true };
  const [hours, setHours] = useState(String(settings.freeCancelHours));
  const [cutoff, setCutoff] = useState(String(settings.bookingCutoffMinutes));
  const [closed, setClosed] = useState<string[]>(settings.closedDays);
  const [waiver, setWaiver] = useState(settings.requiresWaiver);
  const [pick, setPick] = useState<{ day: Weekday; nth: string }>({ day: "Mo", nth: "" });
  const [mode, setMode] = useState(a.listingMode);
  const { busy, error, submit, err } = useSubmit(t);
  const rule = pick.nth ? `${pick.day}#${pick.nth}` : pick.day;

  const save = async () => {
    const ok = await submit(() =>
      api("PUT", `/operators/${op}/activities/${id}`, {
        freeCancelHours: num(hours),
        bookingCutoffMinutes: num(cutoff),
        closedDays: closed,
        requiresWaiver: waiver,
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

function SaveBar({ busy, error, onSave }: { busy: boolean; error: Err; onSave: () => void }) {
  const { t } = useT();
  return (
    <div className="sticky bottom-0 -mx-4 mt-6 border-t border-line bg-paper px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      {error && !error.field && (
        <p role="alert" className="mb-3 font-semibold text-clay">
          {error.text}
        </p>
      )}
      <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={onSave}>
        {t.save}
      </button>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  error,
  hint,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  numeric?: boolean;
}) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(id, note) => (
        <input
          id={id}
          className={`input ${numeric ? "num" : ""}`}
          inputMode={numeric ? "decimal" : undefined}
          value={value}
          aria-describedby={note}
          aria-invalid={!!error || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
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

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 font-display text-xl font-extrabold">{title}</legend>
      {children}
    </fieldset>
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
    active: item?.active ?? true,
    needs: Object.fromEntries(KINDS.map((k) => [k, item?.needs.find((n) => n.kind === k)?.quantity ?? 0])) as Record<ResourceKind, number>,
  });
  const set = (p: Partial<typeof v>) => setV({ ...v, ...p });
  const { busy, error, submit, err } = useSubmit(t);

  const save = async () => {
    const body = {
      activityId: v.activityId,
      nameEn: v.nameEn,
      nameMs: v.nameMs,
      priceSen: sen(v.price),
      durationMinutes: num(v.duration),
      minAge: num(v.minAge),
      maxAge: num(v.maxAge),
      maxWeightKg: num(v.maxWeightKg),
      requiredCert: v.requiredCert.trim() || null,
      minParticipants: v.minParticipants > 1 ? v.minParticipants : null,
      active: v.active,
      needs: KINDS.filter((k) => v.needs[k] > 0).map((k) => ({ kind: k, quantity: v.needs[k] })),
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
        <div className="grid grid-cols-2 gap-4">
          <Input label={t.priceRm} value={v.price} onChange={(price) => set({ price })} error={err("priceSen")} numeric />
          <Input label={t.duration} value={v.duration} onChange={(duration) => set({ duration })} error={err("durationMinutes")} numeric />
        </div>
      </div>
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
      </Group>
      <Group title={t.resourceNeeds}>
        {KINDS.map((k) => (
          <Stepper key={k} label={t.kinds[k]} value={v.needs[k]} min={0} max={10} onChange={(n) => set({ needs: { ...v.needs, [k]: n } })} />
        ))}
        {err("needs") && <p className="text-sm font-semibold text-clay">{err("needs")}</p>}
      </Group>
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
  const options = setup.options.filter((o) => o.activityId === v.activityId);

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
