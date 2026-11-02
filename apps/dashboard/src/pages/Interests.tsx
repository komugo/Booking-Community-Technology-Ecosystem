import { Link } from "wouter";
import { useApi } from "../api";
import { errorText, named, useT } from "../i18n";
import type { InterestRow } from "../types";
import { Icon, LangPill, Spinner } from "../ui";

export default function Interests() {
  const { t, l } = useT();
  const list = useApi<{ activities: InterestRow[] }>("/interests");
  const operators = new Map<string, InterestRow[]>();
  for (const r of list.data?.activities ?? []) operators.set(r.operatorId, [...(operators.get(r.operatorId) ?? []), r]);

  return (
    <div className="mx-auto min-h-dvh w-full max-w-3xl px-4">
      <header className="flex h-16 items-center justify-between">
        <Link href="/" className="-ml-3 inline-flex min-h-11 items-center gap-1 rounded-full pr-3 pl-1 font-semibold text-leaf hover:bg-sand">
          <Icon name="back" className="size-5" />
          {t.backHome}
        </Link>
        <LangPill />
      </header>
      <main className="pt-4 pb-12">
        <h1 className="text-4xl font-extrabold">{t.interests}</h1>
        <p className="mt-2 text-muted">{t.interestsHint}</p>
        {!list.data ? (
          list.error ? (
            <p className="py-16 text-center text-muted">{errorText(list.error, t)}</p>
          ) : (
            <Spinner label={t.loading} />
          )
        ) : operators.size === 0 ? (
          <p className="mt-6 rounded-2xl bg-sand p-4">{t.noInterests}</p>
        ) : (
          <ul className="mt-6 grid gap-3 lg:grid-cols-2" aria-label={t.interests}>
            {[...operators].map(([id, rows]) => (
              <li key={id} className="card p-4" data-operator={id}>
                <div className="flex items-start justify-between gap-3">
                  <p className="font-display text-lg font-bold">{rows[0].operatorName}</p>
                  <span className="num shrink-0 rounded-full bg-sand px-3 py-1 text-sm font-semibold">
                    {t.interested(rows.reduce((n, r) => n + r.count, 0))}
                  </span>
                </div>
                <ul className="mt-3 divide-y divide-line">
                  {rows.map((r) => (
                    <li key={r.activityId} className="flex items-baseline justify-between gap-3 py-2" data-activity={r.activityId}>
                      <span className="min-w-0">
                        {named(r, l)}
                        <span className="ml-2 text-sm text-muted">{t.listingModes[r.listingMode]}</span>
                      </span>
                      <span className="num shrink-0 text-right">
                        <span className="font-semibold">{r.count}</span>
                        {r.notified > 0 && <span className="block text-sm text-muted">{t.notified(r.notified)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
