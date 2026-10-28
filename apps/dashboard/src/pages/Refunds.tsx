import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { api, useApi } from "../api";
import { dateLong, errorText, useT } from "../i18n";
import type { RefundRow } from "../types";
import { Icon, LangPill, Sheet, Spinner, toast } from "../ui";

const rm = (sen: number) => `RM${(sen / 100).toFixed(2)}`;
const DAY = 86_400_000;

export default function Refunds() {
  const { t } = useT();
  const list = useApi<{ due: RefundRow[]; refunded: RefundRow[] }>("/refunds");
  const [confirming, setConfirming] = useState<RefundRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mark(r: RefundRow) {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/refunds/${r.id}/refunded`, {});
      setConfirming(null);
      toast(t.markedRefunded);
      await list.reload();
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
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
      <main className="pt-4 pb-12">
        <h1 className="text-4xl font-extrabold">{t.refundsTitle}</h1>
        {!list.data ? (
          list.error ? (
            <p className="py-16 text-center text-muted">{errorText(list.error, t)}</p>
          ) : (
            <Spinner label={t.loading} />
          )
        ) : (
          <>
            {list.data.due.length === 0 ? (
              <p className="mt-6 rounded-2xl bg-sand p-4">{t.noRefunds}</p>
            ) : (
              <ul className="mt-6 grid gap-3 lg:grid-cols-2" aria-label={t.refundsTitle}>
                {list.data.due.map((r) => (
                  <Card key={r.id} r={r}>
                    <button
                      type="button"
                      className="btn btn-primary mt-4 w-full"
                      onClick={() => {
                        setError(null);
                        setConfirming(r);
                      }}
                    >
                      {t.markRefunded}
                    </button>
                  </Card>
                ))}
              </ul>
            )}
            {list.data.refunded.length > 0 && (
              <section className="mt-10" aria-labelledby="refunded">
                <h2 id="refunded" className="text-2xl font-extrabold">
                  {t.refundedTitle}
                </h2>
                <ul className="mt-3 grid gap-3 lg:grid-cols-2">
                  {list.data.refunded.map((r) => (
                    <Card key={r.id} r={r} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>

      <Sheet
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title={t.markRefunded}
        footer={
          <>
            {error && (
              <p role="alert" className="mb-3 font-semibold text-clay">
                {error}
              </p>
            )}
            <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={() => confirming && mark(confirming)}>
              {t.confirm}
            </button>
          </>
        }
      >
        {confirming && (
          <p className="text-lg" data-confirm-text>
            {t.confirmRefund(rm(confirming.amountSen), confirming.customer.name ?? confirming.customer.email ?? "–", confirming.billId)}
          </p>
        )}
      </Sheet>
    </div>
  );
}

function Card({ r, children }: { r: RefundRow; children?: ReactNode }) {
  const { t, l } = useT();
  const [copied, setCopied] = useState(false);
  const days = Math.floor((Date.now() - r.createdAt) / DAY);
  return (
    <li className="card p-4" data-refund={r.id}>
      <div className="flex items-start justify-between gap-3">
        <p className="num font-display text-3xl font-extrabold">{rm(r.amountSen)}</p>
        <span className="rounded-full bg-sand px-3 py-1 text-sm font-semibold">{t.refundReasons[r.reason]}</span>
      </div>
      <p className="mt-2 font-display text-lg font-bold">{r.customer.name ?? "–"}</p>
      <div className="-ml-2 flex flex-wrap text-sm font-semibold text-leaf">
        {r.customer.phone && (
          <a href={`tel:${r.customer.phone}`} className="num inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 hover:bg-sand">
            <Icon name="phone" className="size-4" />
            {r.customer.phone}
          </a>
        )}
        {r.customer.email && (
          <a href={`mailto:${r.customer.email}`} className="inline-flex min-h-11 items-center rounded-full px-2 break-all hover:bg-sand">
            {r.customer.email}
          </a>
        )}
      </div>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="sr-only">{t.operator}</dt>
          <dd>{r.operatorName}</dd>
          {r.bookingId && <dd className="num text-muted">· {t.bookingRef(r.bookingId.slice(0, 8).toUpperCase())}</dd>}
        </div>
        {r.billId && (
          <div className="flex items-center gap-2">
            <dt className="text-muted">{t.bill}</dt>
            <dd className="num font-mono">{r.billId}</dd>
            <dd>
              <button
                type="button"
                className="min-h-11 px-2 font-semibold text-leaf"
                onClick={() => navigator.clipboard?.writeText(r.billId!).then(() => setCopied(true))}
              >
                {copied ? t.copied : t.copy}
              </button>
            </dd>
          </div>
        )}
      </dl>
      <p className={`mt-2 text-sm font-semibold ${r.refundedAt ? "text-forest" : days >= 5 ? "text-clay" : "text-muted"}`}>
        {r.refundedAt ? t.refundedOn(dateLong(r.refundedAt, l)) : t.dueFor(days)}
      </p>
      {children}
    </li>
  );
}
