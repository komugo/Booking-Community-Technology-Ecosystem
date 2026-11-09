import { useEffect, useState } from "react";
import { Link, Redirect, Route, Switch, useLocation, useRoute } from "wouter";
import { api, useApi } from "./api";
import { openQueue } from "./checkins";
import { CHECK_IN } from "./flags";
import { day, errorText, time, useT } from "./i18n";
import { loadMe, useMe } from "./me";
import Holidays from "./pages/Holidays";
import Interests from "./pages/Interests";
import Leads from "./pages/Leads";
import Payouts from "./pages/Payouts";
import Scan from "./pages/Scan";
import Schedule from "./pages/Schedule";
import Refunds from "./pages/Refunds";
import Setup from "./pages/Setup";
import SignIn from "./pages/SignIn";
import Timeslot from "./pages/Timeslot";
import Today from "./pages/Today";
import Venues from "./pages/Venues";
import type { Me, WhatsAppState } from "./types";
import { LangPill, Logo, SignedInAs, Spinner, TabBar, Toast, toast } from "./ui";

export default function App() {
  const { t } = useT();
  const me = useMe();
  const [failed, setFailed] = useState(false);
  const [path] = useLocation();

  useEffect(() => {
    document.documentElement.lang = t.htmlLang;
  }, [t]);

  useEffect(() => {
    loadMe().catch(() => setFailed(true));
  }, []);

  return (
    <>
      <Switch>
        <Route path="/sign-in" component={SignIn} />
        <Route>
          {me === undefined ? (
            failed ? (
              <div className="py-24 text-center">
                <p className="text-muted">{t.errors.network}</p>
                <button className="btn btn-primary mt-4" onClick={() => location.reload()}>
                  {t.retry}
                </button>
              </div>
            ) : (
              <Spinner label={t.loading} />
            )
          ) : me === null ? (
            <Redirect to={`/sign-in?next=${encodeURIComponent(path)}`} replace />
          ) : (
            <Signed me={me} />
          )}
        </Route>
      </Switch>
      <Toast />
    </>
  );
}

function Signed({ me }: { me: Me }) {
  return (
    <>
      {me.member.role === "staff" && <WhatsAppBanner />}
      <Switch>
        <Route path="/">{me.operators.length === 1 ? <Redirect to={`/o/${me.operators[0].id}/today`} replace /> : <Operators me={me} />}</Route>
        <Route path="/refunds">{me.member.role === "staff" ? <Refunds /> : <NotFound />}</Route>
        <Route path="/payouts">{me.member.role === "staff" ? <Payouts /> : <NotFound />}</Route>
        <Route path="/venues">{me.member.role === "staff" ? <Venues /> : <NotFound />}</Route>
        <Route path="/interests">{me.member.role === "staff" ? <Interests /> : <NotFound />}</Route>
        <Route path="/holidays">{me.member.role === "staff" ? <Holidays /> : <NotFound />}</Route>
        <Route path="/leads">{me.member.role === "staff" ? <Leads /> : <NotFound />}</Route>
        <Route path="/o/:op/*">{({ op }) => (me.operators.some((o) => o.id === op) ? <Shell me={me} op={op} /> : <NotFound />)}</Route>
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

// Staff phone these contacts themselves until the send goes through (ADR 0006).
function WhatsAppBanner() {
  const { t, l } = useT();
  const state = useApi<WhatsAppState>("/whatsapp");
  const { reload } = state;
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    const id = setInterval(reload, 60_000);
    return () => clearInterval(id);
  }, [reload]);

  async function retry(id: string) {
    setBusy(id);
    try {
      await api("POST", `/whatsapp/${id}/retry`, {});
      toast(t.retryQueued);
    } catch (e) {
      toast(errorText(e, t), "error");
    }
    await reload();
    setBusy(undefined);
  }

  const s = state.data;
  if (!s || (s.connected && s.failed.length === 0)) return null;
  return (
    <section role="alert" aria-label="WhatsApp" className="bg-clay px-4 py-3 text-white" data-whatsapp>
      <div className="mx-auto max-w-5xl space-y-2">
        {!s.connected && <p className="font-semibold">{t.whatsappDown}</p>}
        {s.failed.length > 0 && (
          <>
            <p className="font-semibold">{t.whatsappFailed(s.failed.length)}</p>
            <ul className="max-h-60 divide-y divide-white/30 overflow-y-auto">
              {s.failed.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2" data-failed>
                  <span className="min-w-0 text-sm">
                    <span className="block font-semibold">
                      {m.operator} · {m.contact ?? t.removedContact}
                    </span>
                    <a href={`tel:${m.phone}`} className="num underline">
                      {m.phone}
                    </a>{" "}
                    · {t.whatsappTemplates[m.template]} ·{" "}
                    <span className="num">
                      {day(m.at, l)} {time(m.at, l)}
                    </span>
                  </span>
                  {m.contact && (
                    <button
                      type="button"
                      className="btn min-h-11 shrink-0 bg-white px-4 text-clay"
                      aria-label={t.retrySendTo(m.phone)}
                      disabled={busy === m.id}
                      onClick={() => retry(m.id)}
                    >
                      {t.retrySend}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function Shell({ me, op }: { me: Me; op: string }) {
  const { t } = useT();
  const operator = me.operators.find((o) => o.id === op)!;
  const staff = me.member.role === "staff";
  const [scanning] = useRoute("/o/:op/scan");
  useEffect(() => openQueue(op), [op]);
  if (CHECK_IN && scanning) return <Scan />;
  return (
    <div className="min-h-dvh pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-8 lg:pl-28">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
          <div className="min-w-0">
            <p className="truncate font-display text-lg leading-tight font-extrabold">{operator.name}</p>
            {me.operators.length > 1 && (
              <Link href="/" className="text-sm font-semibold text-leaf underline-offset-2 hover:underline">
                {t.switchOperator}
              </Link>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-1">
            {staff && (
              <div className="flex min-w-0 overflow-x-auto">
                <StaffLinks />
              </div>
            )}
            <LangPill />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 pt-5">
        <Switch>
          <Route path="/o/:op/today" component={Today} />
          <Route path="/o/:op/timeslots/:id" component={Timeslot} />
          <Route path="/o/:op/schedule" component={Schedule} />
          <Route path="/o/:op/setup">{staff ? <Setup /> : <NotFound />}</Route>
          <Route component={NotFound} />
        </Switch>
      </main>
      <TabBar op={op} staff={staff} />
    </div>
  );
}

function Operators({ me }: { me: Me }) {
  const { t } = useT();
  return (
    <div className="mx-auto min-h-dvh w-full max-w-xl px-4">
      <header className="flex h-16 items-center justify-between">
        <Logo />
        <LangPill />
      </header>
      <main className="pt-6 pb-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-4xl font-extrabold">{t.pickOperator}</h1>
          {me.member.role === "staff" && <StaffLinks />}
        </div>
        <ul className="mt-6 space-y-3">
          {me.operators.map((o) => (
            <li key={o.id}>
              <Link
                href={`/o/${o.id}/today`}
                className="card flex min-h-16 items-center justify-between px-5 font-display text-xl font-bold hover:bg-sand/40"
              >
                {o.name}
                <span aria-hidden="true" className="text-leaf">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <SignedInAs me={me} />
      </main>
    </div>
  );
}

function StaffLinks() {
  const { t } = useT();
  return (
    <>
      {(
        [
          ["/refunds", t.refunds],
          ["/payouts", t.payouts],
          ["/venues", t.venues],
          ["/interests", t.interests],
          ["/holidays", t.holidays],
          ["/leads", t.leads],
        ] as const
      ).map(([href, label]) => (
        <Link key={href} href={href} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-leaf hover:bg-sand">
          {label}
        </Link>
      ))}
    </>
  );
}

function NotFound() {
  const { t } = useT();
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-4xl font-extrabold">{t.notFound}</h1>
      <p className="mt-3 text-muted">{t.notFoundBody}</p>
      <Link href="/" className="btn btn-primary mt-6">
        {t.backHome}
      </Link>
    </div>
  );
}
