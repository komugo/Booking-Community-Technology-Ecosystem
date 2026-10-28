import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { api } from "../api";
import { errorText, useT } from "../i18n";
import { loadMe } from "../me";
import { Field, LangPill, Logo } from "../ui";

const RESEND_S = 60;

export default function SignIn() {
  const { t, l } = useT();
  const [, navigate] = useLocation();
  const next = new URLSearchParams(useSearch()).get("next");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<{ field: "email" | "code"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!sentAt) return;
    codeRef.current?.focus();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sentAt]);

  async function run(field: "email" | "code", fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError({ field, text: errorText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    return run("email", async () => {
      await api("POST", "/auth/otp", { email, locale: l });
      setSentAt(Date.now());
      setNow(Date.now());
      setCode("");
    });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    return run("code", async () => {
      await api("POST", "/auth/otp/verify", { email, code });
      await loadMe();
      navigate(next?.startsWith("/") && !next.startsWith("//") ? next : "/", { replace: true });
    });
  };

  const wait = sentAt ? Math.max(0, RESEND_S - Math.floor((now - sentAt) / 1000)) : 0;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4">
      <header className="flex h-16 items-center justify-between">
        <Logo />
        <LangPill />
      </header>
      <main className="flex flex-1 flex-col justify-center pb-24">
        <h1 className="text-4xl font-extrabold">{t.signInTitle}</h1>
        {!sentAt ? (
          <form onSubmit={send} className="mt-8 space-y-4" noValidate>
            <p className="text-muted">{t.signInBody}</p>
            <Field label={t.email} error={error?.field === "email" ? error.text : undefined}>
              {(id, note) => (
                <input
                  id={id}
                  className="input"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={error?.field === "email" || undefined}
                  aria-describedby={note}
                />
              )}
            </Field>
            <button className="btn btn-primary w-full" disabled={busy || !email.trim()}>
              {t.sendCode}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-8 space-y-4" noValidate>
            <p className="text-muted">{t.codeSentTo(email)}</p>
            <Field label={t.code} error={error?.field === "code" ? error.text : undefined}>
              {(id, note) => (
                <input
                  id={id}
                  ref={codeRef}
                  className="input num text-center font-mono text-2xl tracking-[0.4em]"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  aria-invalid={error?.field === "code" || undefined}
                  aria-describedby={note}
                />
              )}
            </Field>
            <button className="btn btn-primary w-full" disabled={busy || code.length !== 6}>
              {t.verify}
            </button>
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <button type="button" className="min-h-11 font-semibold text-leaf underline-offset-2 hover:underline" onClick={() => setSentAt(null)}>
                {t.otherEmail}
              </button>
              <button
                type="button"
                className="num min-h-11 font-semibold text-leaf underline-offset-2 enabled:hover:underline disabled:text-muted"
                disabled={busy || wait > 0}
                onClick={() => send()}
              >
                {wait > 0 ? t.resendIn(wait) : t.resend}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
