import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { signOut } from "./me";
import type { Me, Waiver } from "./types";
import { useQueue } from "./checkins";
import { setLocale, t, useT } from "./i18n";
import { store } from "./store";

const PATHS = {
  today: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  scan: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10",
  schedule: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  setup: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  phone:
    "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z",
  check: "M20 6 9 17l-5-5",
  back: "M15 18l-6-6 6-6",
  next: "M9 18l6-6-6-6",
  refresh: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
  x: "M18 6 6 18M6 6l12 12",
  plus: "M12 5v14M5 12h14",
  keyboard: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
};

export function Icon({ name, className = "size-6" }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  full = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  full?: boolean;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={id}
      className={`m-0 mt-auto flex w-full max-w-none flex-col rounded-t-3xl bg-paper p-0 text-ink not-open:hidden sm:m-auto sm:max-w-lg sm:rounded-3xl ${full ? "h-dvh max-h-dvh rounded-none sm:h-auto sm:max-h-[90dvh]" : "max-h-[92dvh]"}`}
    >
      {open && (
        <>
          <div className="flex items-center justify-between gap-3 px-4 pt-3">
            <h2 id={id} className="text-2xl font-extrabold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t.close}
              className="-mr-2 flex size-12 items-center justify-center rounded-full hover:bg-sand"
            >
              <Icon name="x" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pt-2 pb-4">{children}</div>
          {footer && <div className="border-t border-line bg-paper px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: (id: string, describedBy?: string) => ReactNode;
}) {
  const id = useId();
  const note = error || hint ? `${id}-note` : undefined;
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children(id, note)}
      {note && (
        <p id={note} className={`mt-1 text-sm ${error ? "font-semibold text-clay" : "text-muted"}`}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-semibold">{label}</span>
      <div className="flex items-center gap-1" role="group" aria-label={label}>
        <button
          type="button"
          className="btn btn-quiet w-12 px-0"
          aria-label={`${label} −`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
        >
          −
        </button>
        <output className="num w-8 text-center text-lg font-bold">{value}</output>
        <button
          type="button"
          className="btn btn-quiet w-12 px-0"
          aria-label={`${label} +`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 font-semibold">
      {label}
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden="true"
        className="relative h-8 w-14 shrink-0 rounded-full bg-line transition peer-checked:bg-leaf peer-focus-visible:outline-3 peer-focus-visible:outline-lime after:absolute after:top-1 after:left-1 after:size-6 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-6"
      />
    </label>
  );
}

const toasts = store<{ id: number; text: string; tone: "ok" | "error" } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string, tone: "ok" | "error" = "ok") {
  clearTimeout(toastTimer);
  toasts.set({ id: Date.now(), text, tone });
  toastTimer = setTimeout(() => toasts.set(null), 5000);
}

export function clearToast() {
  clearTimeout(toastTimer);
  toasts.set(null);
}

export function Toast() {
  const t = toasts.use();
  const [path] = useLocation();
  // The scanner has no TabBar and its result panel sits at the bottom.
  const place = path.endsWith("/scan")
    ? "top-[calc(4.5rem+env(safe-area-inset-top))]"
    : "bottom-[calc(5.5rem+env(safe-area-inset-bottom))] lg:bottom-6";
  return (
    <div role="status" aria-live="polite" className={`pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4 ${place}`}>
      {t && (
        <p
          key={t.id}
          className={`rounded-2xl px-4 py-3 font-semibold shadow-lg ${t.tone === "error" ? "bg-clay text-white" : "bg-forest text-white"}`}
        >
          {t.text}
        </p>
      )}
    </div>
  );
}

const subscribeOnline = (cb: () => void) => {
  addEventListener("online", cb);
  addEventListener("offline", cb);
  return () => {
    removeEventListener("online", cb);
    removeEventListener("offline", cb);
  };
};
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine);

export function SyncPill({ onClick }: { onClick: () => void }) {
  const { t } = useT();
  const online = useOnline();
  const waiting = useQueue().scans.filter((s) => s.state === "pending").length;
  const [text, tone] = !online
    ? [waiting ? t.offlineWaiting(waiting) : t.offline, "bg-clay text-white"]
    : waiting
      ? [t.waiting(waiting), "bg-sand text-ink"]
      : [t.synced, "bg-lime text-ink"];
  return (
    <button
      type="button"
      onClick={onClick}
      data-sync
      className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold whitespace-nowrap ${tone}`}
    >
      <span aria-hidden="true" className="size-2 rounded-full bg-current" />
      {text}
    </button>
  );
}

export function TabBar({ op }: { op: string }) {
  const { t } = useT();
  const [path] = useLocation();
  const tabs = [
    { href: `/o/${op}/today`, label: t.today, icon: "today" },
    { href: `/o/${op}/scan`, label: t.scan, icon: "scan" },
    { href: `/o/${op}/schedule`, label: t.schedule, icon: "schedule" },
    { href: `/o/${op}/setup`, label: t.setup, icon: "setup" },
  ] as const;
  return (
    <nav
      aria-label={t.mainNav}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:inset-y-0 lg:right-auto lg:w-28 lg:border-t-0 lg:border-r lg:pt-24 lg:pb-0"
    >
      <ul className="mx-auto grid h-16 max-w-lg grid-cols-4 lg:h-auto lg:grid-cols-1 lg:gap-3">
        {tabs.map((tab) => {
          const current = path.startsWith(tab.href) || (tab.icon === "schedule" && path.startsWith(`/o/${op}/timeslots`));
          const scan = tab.icon === "scan";
          return (
            <li key={tab.href} className="flex justify-center">
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-12 w-full flex-col items-center justify-center gap-0.5 text-xs font-semibold lg:min-h-16 ${current ? "text-forest" : "text-muted hover:text-ink"}`}
              >
                <span
                  className={
                    scan
                      ? "-mt-6 flex size-14 items-center justify-center rounded-full bg-lime text-ink shadow-[0_8px_20px_-8px_rgb(14_26_20/0.5)] lg:mt-0"
                      : `flex h-8 w-14 items-center justify-center rounded-full ${current ? "bg-lime/40" : ""}`
                  }
                >
                  <Icon name={tab.icon} className={scan ? "size-7" : "size-6"} />
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <p role="status" className="py-16 text-center text-muted">
      {label}
    </p>
  );
}

export function LangPill({ dark = false }: { dark?: boolean }) {
  const { t: d, l } = useT();
  return (
    <div role="group" aria-label={d.language} className={`flex rounded-full p-1 text-sm font-semibold ${dark ? "bg-white/15" : "bg-sand"}`}>
      {(["en", "ms"] as const).map((x) => (
        <button
          key={x}
          type="button"
          lang={x}
          aria-pressed={x === l}
          onClick={() => setLocale(x)}
          className={`flex min-h-10 min-w-11 items-center justify-center rounded-full px-3 ${x === l ? "bg-white text-ink" : dark ? "text-white hover:bg-white/20" : "hover:bg-white/60"}`}
        >
          {t[x].langName}
        </button>
      ))}
    </div>
  );
}

export function Logo() {
  return (
    <span className="font-display text-2xl font-extrabold tracking-tight">
      komugo<span className="text-leaf">.</span>
    </span>
  );
}

export function SignedInAs({ me }: { me: Me }) {
  const { t } = useT();
  const [, navigate] = useLocation();
  return (
    <p className="mt-10 flex flex-wrap items-center gap-x-3 text-sm text-muted">
      {me.member.email}
      <button
        className="min-h-11 font-semibold text-leaf underline-offset-2 hover:underline"
        onClick={() => signOut().then(() => navigate("/sign-in"))}
      >
        {t.signOut}
      </button>
    </p>
  );
}

export function WaiverChip({ waiver, signer }: { waiver: Waiver; signer: string | null }) {
  const { t } = useT();
  const ok = waiver === "signed" || waiver === "guardian";
  return (
    <span
      data-waiver={waiver}
      className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${ok ? "bg-lime/40 text-forest" : "bg-clay text-white"}`}
    >
      {waiver === "guardian" ? t.guardian(signer ?? "") : t.waiver[waiver]}
    </span>
  );
}
