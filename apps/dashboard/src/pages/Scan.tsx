import jsQR from "jsqr";
import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { Link, useParams } from "wouter";
import { scan, useQueue, type Scan } from "../checkins";
import { lookup, today, useDay } from "../day";
import { day, named, time, useT, type Dict } from "../i18n";
import type { Locale, Outcome } from "../types";
import { clearToast, Icon, LangPill, Sheet, SyncPill, toast, useOnline, WaiverChip } from "../ui";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAME_CODE_MS = 3000;

type Kind = Outcome | "checking" | "saved";
const TONE: Record<Kind, string> = {
  checked_in: "bg-lime text-forest",
  already: "bg-sand text-ink",
  saved: "bg-sand text-ink",
  checking: "bg-white text-ink",
  not_today: "bg-clay text-white",
  closed: "bg-clay text-white",
  cancelled: "bg-clay text-white",
  not_found: "bg-clay text-white",
  ambiguous: "bg-clay text-white",
};
const BUZZ: Partial<Record<Kind, number | number[]>> = { checked_in: 60, already: [60, 80, 60], saved: [60, 80, 60] };

function kind(s: Scan, online: boolean): Kind {
  if (s.state !== "pending") return s.outcome!;
  if (s.local === "ok") return "checked_in";
  if (s.local === "unknown") return online ? "checking" : "saved";
  return s.local;
}

function outcomeText(k: Kind, s: Scan, t: Dict, l: Locale) {
  if (k === "checking") return t.checking;
  if (k === "saved") return t.savedOffline;
  if (k === "already") return t.already(time(s.ticket?.checkedInAt ?? s.checkedInAt ?? s.at, l));
  if (k === "not_today") return t.notToday(s.ticket ? `${day(s.ticket.startsAt, l)}, ${time(s.ticket.startsAt, l)}` : "");
  return t.outcome[k];
}

export default function ScanPage() {
  const { t, l } = useT();
  const { op } = useParams<{ op: string }>();
  const online = useOnline();
  const { scans } = useQueue();
  const { data } = useDay(op, today());
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cam, setCam] = useState<"starting" | "on" | "off">("starting");
  const [current, setCurrent] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [log, setLog] = useState(false);
  const [code, setCode] = useState("");
  const last = useRef({ code: "", at: 0 });
  const paused = useRef(false);
  const states = useRef(new Map(scans.map((s) => [s.requestId, s.state])));

  const shown = scans.find((s) => s.requestId === current);
  const shownKind = shown && kind(shown, online);
  paused.current = !!shownKind && shownKind !== "checked_in" && shownKind !== "checking";

  const submit = (raw: string) => {
    last.current = { code: raw, at: Date.now() };
    clearToast();
    setCurrent(scan(raw));
  };
  const onCode = useRef(submit);
  onCode.current = submit;

  useEffect(() => {
    if (shownKind && BUZZ[shownKind] !== undefined) navigator.vibrate?.(BUZZ[shownKind]!);
    else if (shownKind && shownKind !== "checking") navigator.vibrate?.(300);
  }, [shownKind, current]);

  useEffect(() => {
    for (const s of scans) {
      const before = states.current.get(s.requestId);
      if (before === "pending" && s.state === "rejected" && s.requestId !== current && (s.local === "ok" || s.local === "unknown")) {
        toast(t.rejected(s.ticket?.participant.name ?? s.name, outcomeText(s.outcome!, s, t, l)), "error");
      }
      states.current.set(s.requestId, s.state);
    }
  }, [scans, current, t, l]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    const stop = () => {
      clearInterval(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
      stream = null;
    };
    const tick = () => {
      const v = videoRef.current;
      if (!v || v.readyState < 2 || paused.current) return;
      const side = Math.min(v.videoWidth, v.videoHeight);
      const size = Math.min(480, side);
      canvas.width = canvas.height = size;
      ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, size, size);
      const hit = jsQR(ctx.getImageData(0, 0, size, size).data, size, size, { inversionAttempts: "dontInvert" });
      const text = hit?.data.trim();
      if (!text) return;
      // A QR held in frame keeps refreshing its window, so it only re-scans after leaving the frame.
      if (text === last.current.code && Date.now() - last.current.at < SAME_CODE_MS) {
        last.current.at = Date.now();
        return;
      }
      onCode.current(text);
    };
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch {
        if (!cancelled) setCam("off");
        return;
      }
      if (cancelled) return stop();
      videoRef.current!.srcObject = stream;
      await videoRef.current!.play().catch(() => {});
      setCam("on");
      timer = setInterval(tick, 125);
    };
    const onVisible = () => (document.visibilityState === "hidden" ? stop() : !stream && start());
    start();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const now = Date.now();
  const slot = data?.timeslots.find((s) => !s.closedAt && s.startsAt + s.option.durationMinutes * 60_000 > now);
  const slotTickets = slot?.groups.flatMap((g) => g.tickets) ?? [];
  const checked = slotTickets.filter((x) => x.checkedInAt || scans.some((s) => s.ticketId === x.id && s.state === "done")).length;
  const hit = shown && !shown.ticket ? lookup(op, shown.code) : null;
  const info = shown?.ticket
    ? { ...shown.ticket, name: shown.ticket.participant.name }
    : hit && { ...hit.ticket, name: hit.ticket.participant.name, startsAt: hit.slot.startsAt, option: hit.slot.option };

  function typed(value: string) {
    const v = value
      .toUpperCase()
      .replace(/[^0-9A-F]/g, "")
      .slice(0, 8);
    setCode(v);
    if (v.length === 8) {
      setTyping(false);
      submit(v);
    }
  }

  function pasted(e: ClipboardEvent<HTMLInputElement>) {
    const v = e.clipboardData.getData("text").trim();
    if (!UUID.test(v)) return;
    e.preventDefault();
    setTyping(false);
    submit(v);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink text-white">
      <header className="flex items-center justify-between gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <Link
          href={`/o/${op}/today`}
          className="inline-flex min-h-12 min-w-12 items-center gap-1 rounded-full pr-3 pl-1 font-semibold whitespace-nowrap hover:bg-white/10"
        >
          <Icon name="back" className="size-5" />
          <span className="sr-only min-[420px]:not-sr-only">{t.today}</span>
        </Link>
        <SyncPill onClick={() => setLog(true)} />
        <LangPill dark />
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <h1 className="sr-only">{t.scan}</h1>
          <video ref={videoRef} playsInline muted autoPlay className={`absolute inset-0 size-full object-cover ${cam === "on" ? "" : "invisible"}`} />
          {cam === "off" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center" data-camera-off>
              <h2 className="text-3xl font-extrabold">{t.noCamera}</h2>
              <p className="mt-3 max-w-xs text-white/75">{t.noCameraBody}</p>
              <button type="button" className="btn mt-6 bg-lime px-8 text-lg text-ink" onClick={() => setTyping(true)}>
                <Icon name="keyboard" />
                {t.typeCode}
              </button>
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
              <div aria-hidden="true" className="relative size-[min(70vmin,20rem)] rounded-3xl shadow-[0_0_0_100vmax_rgb(14_26_20/0.55)]">
                {[
                  "top-0 left-0 border-t-4 border-l-4 rounded-tl-3xl",
                  "top-0 right-0 border-t-4 border-r-4 rounded-tr-3xl",
                  "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-3xl",
                  "right-0 bottom-0 border-r-4 border-b-4 rounded-br-3xl",
                ].map((c) => (
                  <span key={c} className={`absolute size-10 border-lime ${c}`} />
                ))}
              </div>
              <p className="relative text-sm font-semibold text-white/85">{cam === "on" ? t.pointCamera : t.startingCamera}</p>
            </div>
          )}
          {slot && (
            <p className="num absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-ink/80 px-4 py-2 text-sm font-semibold">
              {time(slot.startsAt, l)} {named(slot.option, l)} · {checked}/{slotTickets.length} ✓
            </p>
          )}
        </div>

        <div aria-live="assertive">
        {shown && shownKind && (
          <section data-result={shownKind} className={`px-5 pt-5 pb-3 ${TONE[shownKind]}`}>
            <p className="flex items-center gap-2 text-sm font-bold tracking-wide uppercase">
              {shownKind === "checked_in" && <Icon name="check" className="size-5" />}
              {outcomeText(shownKind, shown, t, l)}
            </p>
            {info && (
              <>
                <p className="mt-1 font-display text-4xl leading-none font-extrabold">{info.name}</p>
                <p className="num mt-2 text-sm font-semibold opacity-80">
                  {time(info.startsAt, l)} · {named(info.option, l)} · {info.code}
                </p>
                <WaiverChip waiver={info.waiver} signer={info.signerName} />
              </>
            )}
            {shown.state === "pending" && shownKind !== "checking" && shownKind !== "saved" && (
              <p className="mt-2 text-right text-xs font-semibold opacity-75">◷ {t.pending}</p>
            )}
          </section>
        )}
        </div>

        {cam !== "off" && (
          <div className="grid grid-cols-2 gap-3 bg-ink px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button type="button" className="btn min-h-14 border border-white/25 text-white hover:bg-white/10" onClick={() => setTyping(true)}>
              <Icon name="keyboard" />
              {t.typeCode}
            </button>
            <button type="button" className="btn min-h-14 bg-lime text-ink" onClick={() => setCurrent(null)}>
              {t.scanNext}
            </button>
          </div>
        )}
      </main>

      <Sheet
        open={typing}
        onClose={() => {
          setTyping(false);
          setCode("");
        }}
        title={t.typeCode}
      >
        <label htmlFor="code" className="label">
          {t.typeCodeHint}
        </label>
        <input
          id="code"
          data-autofocus
          className="input num text-center font-mono text-3xl tracking-[0.3em] uppercase"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={8}
          pattern="[0-9A-Fa-f]{8}"
          placeholder="A1B2C3D4"
          value={code}
          onChange={(e) => typed(e.target.value)}
          onPaste={pasted}
        />
      </Sheet>

      <Sheet open={log} onClose={() => setLog(false)} title={t.recentScans}>
        {scans.length === 0 ? (
          <p className="text-muted">{t.noScans}</p>
        ) : (
          <ul className="divide-y divide-line">
            {scans.slice(0, 30).map((s) => {
              const k = kind(s, online);
              return (
                <li key={s.requestId} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{s.ticket?.participant.name || s.name || s.code.slice(0, 8).toUpperCase()}</p>
                    <p className={`text-sm ${s.state === "rejected" ? "font-semibold text-clay" : "text-muted"}`}>
                      {s.state === "pending" ? t.pending : outcomeText(k, s, t, l)}
                    </p>
                  </div>
                  <span className="num shrink-0 text-sm text-muted">{time(s.at, l)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>
    </div>
  );
}
