import { useEffect, useState } from "react";
import { Link, Redirect, Route, Switch, useLocation, useRoute } from "wouter";
import { openQueue } from "./checkins";
import { useT } from "./i18n";
import { loadMe, useMe } from "./me";
import Scan from "./pages/Scan";
import Schedule from "./pages/Schedule";
import Setup from "./pages/Setup";
import SignIn from "./pages/SignIn";
import Timeslot from "./pages/Timeslot";
import Today from "./pages/Today";
import type { Me } from "./types";
import { LangPill, Logo, SignedInAs, Spinner, TabBar, Toast } from "./ui";

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
    <Switch>
      <Route path="/">{me.operators.length === 1 ? <Redirect to={`/o/${me.operators[0].id}/today`} replace /> : <Operators me={me} />}</Route>
      <Route path="/o/:op/*">{({ op }) => (me.operators.some((o) => o.id === op) ? <Shell me={me} op={op} /> : <NotFound />)}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function Shell({ me, op }: { me: Me; op: string }) {
  const { t } = useT();
  const operator = me.operators.find((o) => o.id === op)!;
  const [scanning] = useRoute("/o/:op/scan");
  useEffect(() => openQueue(op), [op]);
  if (scanning) return <Scan />;
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
          <LangPill />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 pt-5">
        <Switch>
          <Route path="/o/:op/today" component={Today} />
          <Route path="/o/:op/timeslots/:id" component={Timeslot} />
          <Route path="/o/:op/schedule" component={Schedule} />
          <Route path="/o/:op/setup" component={Setup} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <TabBar op={op} />
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
        <h1 className="text-4xl font-extrabold">{t.pickOperator}</h1>
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
