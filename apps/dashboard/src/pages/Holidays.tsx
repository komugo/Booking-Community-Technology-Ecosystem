import { useState } from "react";
import { Link } from "wouter";
import { api, useApi } from "../api";
import { Input, SaveBar, useSubmit } from "../form";
import { dateLong, errorText, useT } from "../i18n";
import type { Holiday } from "../types";
import { Icon, LangPill, Spinner, toast } from "../ui";

export default function Holidays() {
  const { t, l } = useT();
  const list = useApi<{ holidays: Holiday[] }>("/holidays");
  const [v, setV] = useState({ date: "", name: "" });
  const { busy, error, submit, err } = useSubmit(t);

  const add = async () => {
    if (await submit(() => api("POST", "/holidays", v))) {
      setV({ date: "", name: "" });
      await list.reload();
    }
  };

  async function remove(h: Holiday) {
    try {
      await api("POST", `/holidays/${h.date}/remove`, {});
      await list.reload();
    } catch (e) {
      toast(errorText(e, t), "error");
    }
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-3xl px-4">
      <header className="flex h-16 items-center justify-between">
        <Link href="/" className="-ml-3 inline-flex min-h-11 items-center gap-1 rounded-full pr-3 pl-1 font-semibold text-leaf hover:bg-sand">
          <Icon name="back" className="size-5" />
          {t.backHome}
        </Link>
        <LangPill />
      </header>
      <main className="pt-4">
        <h1 className="text-4xl font-extrabold">{t.holidays}</h1>
        <p className="mt-2 text-muted">{t.holidaysHint}</p>
        {!list.data ? (
          list.error ? (
            <p className="py-16 text-center text-muted">{errorText(list.error, t)}</p>
          ) : (
            <Spinner label={t.loading} />
          )
        ) : list.data.holidays.length === 0 ? (
          <p className="mt-6 rounded-2xl bg-sand p-4">{t.noHolidays}</p>
        ) : (
          <ul className="card mt-6 divide-y divide-line" aria-label={t.holidays}>
            {list.data.holidays.map((h) => (
              <li key={h.date} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0">
                  <span className="num font-semibold">{dateLong(Date.parse(`${h.date}T00:00:00+08:00`), l)}</span>
                  <span className="ml-2">{h.name}</span>
                </span>
                <button type="button" className="btn btn-quiet shrink-0" aria-label={t.removeHoliday(h.name)} onClick={() => remove(h)}>
                  <Icon name="x" className="size-5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <section className="mt-10 space-y-4" aria-labelledby="add-holiday">
          <h2 id="add-holiday" className="text-2xl font-extrabold">
            {t.addHoliday}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t.holidayDate} value={v.date} onChange={(date) => setV({ ...v, date })} error={err("date")} hint="YYYY-MM-DD" />
            <Input label={t.holidayName} value={v.name} onChange={(name) => setV({ ...v, name })} error={err("name")} />
          </div>
          <SaveBar busy={busy} error={error} onSave={add} />
        </section>
      </main>
    </div>
  );
}
