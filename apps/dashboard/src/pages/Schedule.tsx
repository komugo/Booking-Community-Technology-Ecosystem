import { isClosedDay, klDate, klWeekday, WEEKDAYS, type Weekday } from "@komugo/types/rules";
import { useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { api, useApi } from "../api";
import { addDays, today, visible } from "../day";
import { dateLong, day, errorText, named, time, useT, type Dict } from "../i18n";
import { rm, sen } from "../money";
import type { Generated, Locale, Schedule, Setup, Timeslot } from "../types";
import { Field, Icon, Sheet, Spinner, toast, Toggle } from "../ui";

const monday = (d: string) => addDays(d, -WEEKDAYS.indexOf(klWeekday(d)));
const noon = (d: string) => Date.parse(`${d}T12:00:00+08:00`);

function daysText(days: Weekday[], t: Dict) {
  const set = new Set(days);
  if (set.size === 7) return t.everyDay;
  if (set.size === 5 && !set.has("Sa") && !set.has("Su")) return t.weekdays;
  if (set.size === 2 && set.has("Sa") && set.has("Su")) return t.weekend;
  return WEEKDAYS.filter((d) => set.has(d))
    .map((d) => t.dayShort[d])
    .join(", ");
}

export default function SchedulePage() {
  const { t, l } = useT();
  const { op } = useParams<{ op: string }>();
  const [, navigate] = useLocation();
  const week = monday(new URLSearchParams(useSearch()).get("w") ?? today());
  const setup = useApi<Setup>(`/operators/${op}/setup`);
  const slots = useApi<{ timeslots: Timeslot[] }>(`/operators/${op}/timeslots?from=${week}&days=7`);
  const [editing, setEditing] = useState<Schedule | "new" | null>(null);
  const [oneOff, setOneOff] = useState(false);
  const [kept, setKept] = useState<Generated["kept"]>([]);

  if (!setup.data) return setup.error ? <p className="py-16 text-center text-muted">{errorText(setup.error, t)}</p> : <Spinner label={t.loading} />;
  const s = setup.data;
  const optionName = (id: string) => {
    const o = s.options.find((x) => x.id === id);
    return o ? named(o, l) : "";
  };
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const list = visible(slots.data?.timeslots ?? []);

  const saved = (g: Generated) => {
    toast(t.generated(g.created, g.removed));
    setKept(g.kept);
    setup.reload();
    slots.reload();
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-4xl font-extrabold">{t.schedule}</h1>
        <button type="button" className="btn btn-quiet" onClick={() => setOneOff(true)}>
          <Icon name="plus" className="size-5" />
          {t.addOneOff}
        </button>
      </div>

      {kept.length > 0 && (
        <div role="status" className="mt-5 rounded-2xl bg-sand p-4">
          <p className="font-semibold">{t.kept(kept.length)}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {kept.map((k) => (
              <li key={k.id}>
                <Link
                  href={`/o/${op}/timeslots/${k.id}`}
                  className="num inline-flex min-h-11 items-center rounded-full bg-white px-3 text-sm font-semibold"
                >
                  {day(k.startsAt, l)} {time(k.startsAt, l)} · {optionName(k.optionId)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-2">
        <button
          type="button"
          className="btn btn-quiet w-12 px-0"
          aria-label={t.prevWeek}
          onClick={() => navigate(`/o/${op}/schedule?w=${addDays(week, -7)}`, { replace: true })}
        >
          <Icon name="back" className="size-5" />
        </button>
        <h2 className="num text-center text-xl font-extrabold" aria-live="polite">
          {t.week(dateLong(noon(week), l))}
        </h2>
        <button
          type="button"
          className="btn btn-quiet w-12 px-0"
          aria-label={t.nextWeek}
          onClick={() => navigate(`/o/${op}/schedule?w=${addDays(week, 7)}`, { replace: true })}
        >
          <Icon name="next" className="size-5" />
        </button>
      </div>

      <ol className="mt-4 space-y-2">
        {days.map((d) => {
          const closed = s.activities.length > 0 && s.activities.every((a) => isClosedDay(d, a.closedDays));
          const mine = list.filter((x) => klDate(x.startsAt) === d);
          return (
            <li
              key={d}
              data-date={d}
              data-closed={closed || undefined}
              className={`rounded-2xl p-3 ${closed ? "bg-sand" : "card"} ${d === today() ? "ring-2 ring-lime" : ""}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="num text-lg font-extrabold">{day(noon(d), l)}</h3>
                {closed && <span className="text-sm font-semibold text-muted">{t.closedDay}</span>}
              </div>
              {mine.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {mine.map((x) => {
                    const booked = x.groups.reduce((n, g) => n + g.tickets.length, 0);
                    return (
                      <li key={x.id}>
                        <Link
                          href={`/o/${op}/timeslots/${x.id}`}
                          data-chip
                          className={`num inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-semibold ${x.closedAt ? "border-clay/40 text-clay line-through" : booked ? "border-leaf bg-leaf/10 text-forest" : "border-line bg-white"}`}
                        >
                          {time(x.startsAt, l)} {named(x.option, l)} ·{" "}
                          {x.closedAt ? (t.reasons[(x.closedReason ?? "other") as keyof Dict["reasons"]] ?? t.reasons.other) : t.left(x.spots)}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      <section className="mt-10" aria-labelledby="schedules">
        <div className="flex items-center justify-between gap-3">
          <h2 id="schedules" className="text-3xl font-extrabold">
            {t.schedules}
          </h2>
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
            <Icon name="plus" className="size-5" />
            {t.newSchedule}
          </button>
        </div>
        {s.schedules.length === 0 ? (
          <p className="mt-3 text-muted">{t.noSchedules}</p>
        ) : (
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">
            {s.schedules.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  onClick={() => setEditing(x)}
                  className={`card w-full p-4 text-left hover:bg-sand/40 ${x.active ? "" : "opacity-60"}`}
                >
                  <p className="font-display text-lg font-bold">{x.optionIds.map(optionName).join(", ")}</p>
                  <p className="num mt-1 text-sm text-muted">
                    {[
                      daysText(x.weekdays, t),
                      x.times.join(", "),
                      t.fromDate(dateLong(noon(x.startsOn), l)),
                      x.endsOn && t.untilDate(dateLong(noon(x.endsOn), l)),
                      x.priceSen !== null && rm(x.priceSen),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {!x.active && <span className="mt-2 inline-block rounded-full bg-sand px-2.5 py-0.5 text-xs font-semibold">{t.inactive}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? t.newSchedule : t.editSchedule} full>
        {editing && (
          <ScheduleEditor
            op={op}
            setup={s}
            schedule={editing === "new" ? null : editing}
            onSaved={(g) => {
              setEditing(null);
              saved(g);
            }}
          />
        )}
      </Sheet>
      <Sheet open={oneOff} onClose={() => setOneOff(false)} title={t.addOneOff}>
        {oneOff && (
          <OneOff
            op={op}
            setup={s}
            l={l}
            onSaved={() => {
              setOneOff(false);
              toast(t.oneOffAdded);
              slots.reload();
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function ScheduleEditor({ op, setup, schedule, onSaved }: { op: string; setup: Setup; schedule: Schedule | null; onSaved: (g: Generated) => void }) {
  const { t, l } = useT();
  const [v, setV] = useState<Omit<Schedule, "id">>(
    schedule ?? {
      activityId: setup.activities[0]?.id ?? "",
      optionIds: [],
      weekdays: [...WEEKDAYS],
      times: [],
      startsOn: today(),
      endsOn: null,
      priceSen: null,
      active: true,
    },
  );
  const [price, setPrice] = useState(v.priceSen === null ? "" : String(v.priceSen / 100));
  const [newTime, setNewTime] = useState("09:00");
  const [error, setError] = useState<{ field?: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof v>) => setV({ ...v, ...p });
  const options = setup.options.filter((o) => o.activityId === v.activityId);
  const err = (f: string) => (error?.field === f ? error.text : undefined);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const g = await api<Generated>(schedule ? "PUT" : "POST", `/operators/${op}/schedules${schedule ? `/${schedule.id}` : ""}`, {
        ...v,
        priceSen: sen(price),
      });
      onSaved(g);
    } catch (e) {
      setError({ field: (e as { field?: string }).field, text: errorText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  const addTime = () => newTime && !v.times.includes(newTime) && set({ times: [...v.times, newTime].sort() });

  return (
    <div className="space-y-6">
      {setup.activities.length > 1 && (
        <Field label={t.activity}>
          {(id) => (
            <select id={id} className="input" value={v.activityId} onChange={(e) => set({ activityId: e.target.value, optionIds: [] })}>
              {setup.catalogue.map((a) => (
                <option key={a.id} value={a.id}>
                  {named(a, l)}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <fieldset>
        <legend className="label">{t.options}</legend>
        <div className="space-y-2">
          {options.map((o) => (
            <label
              key={o.id}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line bg-white px-3 has-checked:border-leaf has-checked:bg-leaf/5"
            >
              <input
                type="checkbox"
                className="size-5 accent-leaf"
                checked={v.optionIds.includes(o.id)}
                onChange={(e) => set({ optionIds: e.target.checked ? [...v.optionIds, o.id] : v.optionIds.filter((x) => x !== o.id) })}
              />
              <span className="font-semibold">{named(o, l)}</span>
              {!o.active && <span className="text-sm text-muted">({t.inactive})</span>}
            </label>
          ))}
        </div>
        {err("optionIds") && <p className="mt-1 text-sm font-semibold text-clay">{err("optionIds")}</p>}
      </fieldset>
      <fieldset>
        <legend className="label">{t.days}</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              [t.weekdays, WEEKDAYS.slice(0, 5)],
              [t.weekend, WEEKDAYS.slice(5)],
              [t.everyDay, WEEKDAYS],
            ] as const
          ).map(([label, days]) => (
            <button
              key={label}
              type="button"
              className="chip"
              aria-pressed={daysText(v.weekdays, t) === label}
              onClick={() => set({ weekdays: [...days] })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((d) => (
            <button
              key={d}
              type="button"
              className="chip min-w-0 px-0"
              aria-pressed={v.weekdays.includes(d)}
              aria-label={t.dayNames[d]}
              onClick={() =>
                set({
                  weekdays: v.weekdays.includes(d) ? v.weekdays.filter((x) => x !== d) : WEEKDAYS.filter((x) => x === d || v.weekdays.includes(x)),
                })
              }
            >
              {t.dayShort[d]}
            </button>
          ))}
        </div>
        {err("weekdays") && <p className="mt-1 text-sm font-semibold text-clay">{err("weekdays")}</p>}
      </fieldset>
      <fieldset>
        <legend className="label">{t.startTimes}</legend>
        <ul className="flex flex-wrap gap-2">
          {v.times.map((x) => (
            <li key={x}>
              <button
                type="button"
                className="chip num gap-1.5"
                aria-label={t.removeTime(x)}
                onClick={() => set({ times: v.times.filter((y) => y !== x) })}
              >
                {x}
                <Icon name="x" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <input
            type="time"
            step={900}
            aria-label={t.addTime}
            className="input num w-36"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
          />
          <button type="button" className="btn btn-quiet" onClick={addTime}>
            {t.addTime}
          </button>
        </div>
        {err("times") && <p className="mt-1 text-sm font-semibold text-clay">{err("times")}</p>}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.from} error={err("startsOn")}>
          {(id, note) => (
            <input
              id={id}
              type="date"
              className="input num"
              value={v.startsOn}
              aria-describedby={note}
              onChange={(e) => set({ startsOn: e.target.value })}
            />
          )}
        </Field>
        <Field label={t.until} hint={t.untilHint} error={err("endsOn")}>
          {(id, note) => (
            <input
              id={id}
              type="date"
              className="input num"
              value={v.endsOn ?? ""}
              aria-describedby={note}
              onChange={(e) => set({ endsOn: e.target.value || null })}
            />
          )}
        </Field>
      </div>
      <Field label={t.priceRm} hint={t.schedulePriceHint} error={err("priceSen")}>
        {(id, note) => (
          <input
            id={id}
            className="input num"
            inputMode="decimal"
            value={price}
            aria-describedby={note}
            aria-invalid={!!err("priceSen") || undefined}
            onChange={(e) => setPrice(e.target.value)}
          />
        )}
      </Field>
      <Toggle label={t.active} checked={v.active} onChange={(active) => set({ active })} />
      {error && !error.field && (
        <p role="alert" className="font-semibold text-clay">
          {error.text}
        </p>
      )}
      <div className="sticky bottom-0 -mx-4 border-t border-line bg-paper px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={save}>
          {t.save}
        </button>
      </div>
    </div>
  );
}

function OneOff({ op, setup, l, onSaved }: { op: string; setup: Setup; l: Locale; onSaved: () => void }) {
  const { t } = useT();
  const options = setup.options.filter((o) => o.active);
  const [optionId, setOptionId] = useState(options[0]?.id ?? "");
  const [date, setDate] = useState(today());
  const [at, setAt] = useState("09:00");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activity = setup.activities.find((a) => a.id === options.find((o) => o.id === optionId)?.activityId);
  const closed = !!activity && isClosedDay(date, activity.closedDays);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/operators/${op}/timeslots`, { optionId, startsAt: [Date.parse(`${date}T${at}:00+08:00`)] });
      onSaved();
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Field label={t.option}>
        {(id) => (
          <select id={id} className="input" value={optionId} onChange={(e) => setOptionId(e.target.value)}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {named(o, l)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.date}>
          {(id) => <input id={id} type="date" className="input num" min={today()} value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label={t.time}>
          {(id) => <input id={id} type="time" step={900} className="input num" value={at} onChange={(e) => setAt(e.target.value)} />}
        </Field>
      </div>
      {closed && (
        <p role="alert" className="rounded-xl bg-sand px-4 py-3 font-semibold">
          {t.closedDayConfirm}
        </p>
      )}
      {error && (
        <p role="alert" className="font-semibold text-clay">
          {error}
        </p>
      )}
      <button type="button" className="btn btn-primary w-full" disabled={busy || !optionId || !date || !at} onClick={save}>
        {closed ? t.addAnyway : t.add}
      </button>
    </div>
  );
}
