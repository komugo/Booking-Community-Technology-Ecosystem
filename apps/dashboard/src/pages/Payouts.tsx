import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { api, useApi } from "../api";
import { dateLong, errorText, monthLong, useT } from "../i18n";
import type { PayoutRow } from "../types";
import { Icon, LangPill, Sheet, Spinner, toast } from "../ui";

const rm = (sen: number) => `${sen < 0 ? "−" : ""}RM${(Math.abs(sen) / 100).toFixed(2)}`;
const key = (p: PayoutRow) => `${p.operatorId}/${p.month}`;

export default function Payouts() {
  const { t, l } = useT();
  const list = useApi<{ due: PayoutRow[]; paid: PayoutRow[] }>("/payouts");
  const [confirming, setConfirming] = useState<PayoutRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mark(p: PayoutRow) {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/payouts/${key(p)}/paid`, { amountSen: p.amountSen });
      setConfirming(null);
      toast(t.markedPaid);
      await list.reload();
    } catch (e) {
      setError(errorText(e, t));
      await list.reload();
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
        <h1 className="text-4xl font-extrabold">{t.payoutsTitle}</h1>
        {!list.data ? (
          list.error ? (
            <p className="py-16 text-center text-muted">{errorText(list.error, t)}</p>
          ) : (
            <Spinner label={t.loading} />
          )
        ) : (
          <>
            {list.data.due.length === 0 ? (
              <p className="mt-6 rounded-2xl bg-sand p-4">{t.noPayouts}</p>
            ) : (
              <ul className="mt-6 grid gap-3 lg:grid-cols-2" aria-label={t.payoutsTitle}>
                {list.data.due.map((p) => (
                  <Card key={key(p)} p={p}>
                    <button
                      type="button"
                      className="btn btn-primary mt-4 w-full"
                      onClick={() => {
                        setError(null);
                        setConfirming(p);
                      }}
                    >
                      {t.markPaid}
                    </button>
                  </Card>
                ))}
              </ul>
            )}
            {list.data.paid.length > 0 && (
              <section className="mt-10" aria-labelledby="paid">
                <h2 id="paid" className="text-2xl font-extrabold">
                  {t.paidTitle}
                </h2>
                <ul className="mt-3 grid gap-3 lg:grid-cols-2">
                  {list.data.paid.map((p) => (
                    <Card key={key(p)} p={p} />
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
        title={t.markPaid}
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
            {t.confirmPayout(rm(confirming.amountSen), confirming.operatorName, monthLong(confirming.month, l))}
          </p>
        )}
      </Sheet>
    </div>
  );
}

function Card({ p, children }: { p: PayoutRow; children?: ReactNode }) {
  const { t, l } = useT();
  return (
    <li className="card p-4" data-payout={key(p)}>
      <div className="flex items-start justify-between gap-3">
        <p className="num font-display text-3xl font-extrabold">{rm(p.paidSen ?? p.amountSen)}</p>
        <span className="rounded-full bg-sand px-3 py-1 text-sm font-semibold">{monthLong(p.month, l)}</span>
      </div>
      <p className="mt-2 font-display text-lg font-bold">{p.operatorName}</p>
      <dl className="mt-2 space-y-1 text-sm">
        {(
          [
            [t.sales, p.salesSen],
            [t.commission, -p.commissionSen],
            [t.refunds, -p.refundsSen],
          ] as const
        ).map(([label, sen]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="text-muted">{label}</dt>
            <dd className="num">{rm(sen)}</dd>
          </div>
        ))}
      </dl>
      {p.paidAt && <p className="mt-2 text-sm font-semibold text-forest">{t.paidOn(dateLong(p.paidAt, l))}</p>}
      {p.paidSen !== null && p.paidSen !== p.amountSen && (
        <p className="mt-2 text-sm font-semibold text-clay">{t.changedSincePaid(`${p.amountSen > p.paidSen ? "+" : ""}${rm(p.amountSen - p.paidSen)}`)}</p>
      )}
      {children}
    </li>
  );
}
