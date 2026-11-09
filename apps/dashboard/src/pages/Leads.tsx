import { useState } from "react";
import { Link } from "wouter";
import { api, useApi } from "../api";
import { dateLong, errorText, time, useT } from "../i18n";
import type { Lead, LeadStatus } from "../types";
import { Icon, LangPill, Spinner, toast } from "../ui";

const STATUSES: LeadStatus[] = ["new", "contacted", "won", "lost"];
const waLink = (n: string) => `https://wa.me/${n.replace(/\D/g, "")}`;

export default function Leads() {
  const { t } = useT();
  const list = useApi<{ leads: Lead[] }>("/leads");

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
        <h1 className="text-4xl font-extrabold">{t.leads}</h1>
        <p className="mt-2 text-muted">{t.leadsHint}</p>
        {!list.data ? (
          list.error ? (
            <p className="py-16 text-center text-muted">{errorText(list.error, t)}</p>
          ) : (
            <Spinner label={t.loading} />
          )
        ) : list.data.leads.length === 0 ? (
          <p className="mt-6 rounded-2xl bg-sand p-4">{t.noLeads}</p>
        ) : (
          <ul className="mt-6 space-y-3" aria-label={t.leads}>
            {list.data.leads.map((r) => (
              <Card key={r.id} r={r} reload={list.reload} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function Card({ r, reload }: { r: Lead; reload: () => Promise<void> }) {
  const { t, l } = useT();
  const [busy, setBusy] = useState(false);

  async function setStatus(status: LeadStatus) {
    setBusy(true);
    try {
      await api("PATCH", `/leads/${r.id}`, { status });
      toast(t.statusSaved);
      await reload();
    } catch (e) {
      toast(errorText(e, t), "error");
    } finally {
      setBusy(false);
    }
  }

  const details = [
    [t.leadBudget, r.budget],
    [t.leadAgency, r.agency],
    [t.leadProcurement, r.procurement && t.procurements[r.procurement]],
    [t.leadTimeline, r.timeline],
  ] as const;

  return (
    <li className="card p-4" data-lead={r.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-lg font-bold">{r.name}</p>
          {r.company && <p className="text-muted">{r.company}</p>}
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm font-semibold">
          {t.leadStatus}
          <select className="input w-auto" value={r.status} disabled={busy} onChange={(e) => setStatus(e.target.value as LeadStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.leadStatuses[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        <span className="rounded-full bg-sand px-3 py-1 font-semibold">{r.packageId ? t.leadPackages[r.packageId] : t.noPackage}</span>
        <span className="rounded-full bg-sand px-3 py-1 font-semibold">{t.leadKinds[r.kind]}</span>
      </div>
      <p className="mt-2 text-sm text-muted">
        <span className="num">
          {dateLong(r.createdAt, l)} {time(r.createdAt, l)}
        </span>{" "}
        · <span className="break-all">{t.leadFrom(r.sourcePage, r.locale.toUpperCase())}</span>
      </p>
      <details className="mt-3 border-t border-line pt-1">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-leaf">{t.leadDetails}</summary>
        <p className="text-sm font-semibold">{t.leadBrief}</p>
        <p className="mt-1 whitespace-pre-wrap">{r.brief}</p>
        <div className="-ml-2 mt-2 flex flex-wrap text-sm font-semibold text-leaf">
          <a href={waLink(r.whatsapp)} target="_blank" rel="noreferrer" className="num inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 hover:bg-sand">
            <Icon name="phone" className="size-4" />
            {r.whatsapp}
          </a>
          <a href={`mailto:${encodeURIComponent(r.email)}`} className="inline-flex min-h-11 items-center rounded-full px-2 break-all hover:bg-sand">
            {r.email}
          </a>
        </div>
        <dl className="mt-2 space-y-1 text-sm">
          {details.map(
            ([label, value]) =>
              value && (
                <div key={label} className="flex gap-2">
                  <dt className="text-muted">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ),
          )}
        </dl>
      </details>
    </li>
  );
}
