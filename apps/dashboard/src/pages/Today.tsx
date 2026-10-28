import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { scan, useQueue } from "../checkins";
import { addDays, today, useDay } from "../day";
import { day, named, time, useT } from "../i18n";
import type { Ticket, Timeslot } from "../types";
import { Icon, Sheet, WaiverChip } from "../ui";

export default function Today() {
  const { t, l } = useT();
  const { op } = useParams<{ op: string }>();
  const [, navigate] = useLocation();
  const now = today();
  const date = new URLSearchParams(useSearch()).get("d") ?? now;
  const { data, offline, busy, refresh } = useDay(op, date);
  const scans = useQueue().scans;
  const done = scans.filter((s) => s.state !== "pending").length;
  const [confirm, setConfirm] = useState<{ ticket: Ticket; slot: Timeslot } | null>(null);

  const seen = useRef(done);
  useEffect(() => {
    if (done === seen.current) return;
    seen.current = done;
    refresh();
  }, [done, refresh]);

  const go = (d: string) => navigate(d === now ? `/o/${op}/today` : `/o/${op}/today?d=${d}`, { replace: true });
  const chips = [
    [addDays(now, -1), t.yesterday],
    [now, t.today],
    [addDays(now, 1), t.tomorrow],
  ] as const;

  return (
    <>
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-4xl font-extrabold">{date === now ? t.today : day(Date.parse(`${date}T12:00:00+08:00`), l)}</h1>
        <button
          type="button"
          onClick={refresh}
          disabled={busy}
          className="num -mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-muted hover:bg-sand"
        >
          {data && t.updated(time(data.at, l))}
          <Icon name="refresh" className={`size-4 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {chips.map(([d, label]) => (
          <button key={d} type="button" className="chip" aria-pressed={d === date} onClick={() => go(d)}>
            {label}
          </button>
        ))}
        <label className="chip relative has-focus-visible:outline-3 has-focus-visible:outline-lime">
          <span className="sr-only">{t.pickDate}</span>
          <input type="date" value={date} onChange={(e) => e.target.value && go(e.target.value)} className="num bg-transparent outline-none" />
        </label>
      </div>
      <div role="status">
        {offline && data && <p className="mt-4 rounded-xl bg-sand px-4 py-3 font-semibold">{t.offlineShowing(time(data.at, l))}</p>}
      </div>
      {!data ? (
        <p className="py-16 text-center text-muted">{offline ? t.errors.network : t.loading}</p>
      ) : data.timeslots.length === 0 ? (
        <p className="py-16 text-center text-muted">{t.noTimeslots}</p>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {data.timeslots.map((slot) => (
            <SlotCard key={slot.id} op={op} slot={slot} checkable={date === now} onCheckIn={(ticket) => setConfirm({ ticket, slot })} />
          ))}
        </div>
      )}
      <Sheet open={!!confirm} onClose={() => setConfirm(null)} title={t.checkIn}>
        {confirm && (
          <>
            <p className="text-lg">{t.checkInWho(confirm.ticket.participant.name, time(confirm.slot.startsAt, l))}</p>
            <button
              type="button"
              className="btn btn-primary mt-5 w-full"
              onClick={() => {
                scan(confirm.ticket.id);
                setConfirm(null);
              }}
            >
              {t.checkIn}
            </button>
          </>
        )}
      </Sheet>
    </>
  );
}

function SlotCard({ op, slot, checkable, onCheckIn }: { op: string; slot: Timeslot; checkable: boolean; onCheckIn: (t: Ticket) => void }) {
  const { t, l } = useT();
  const scans = useQueue().scans;
  const tickets = slot.groups.flatMap((g) => g.tickets);
  const resources = [...new Set(tickets.flatMap((x) => x.resources))];
  const closed = !!slot.closedAt;
  const reason = t.reasons[(slot.closedReason ?? "other") as keyof typeof t.reasons] ?? t.reasons.other;

  return (
    <article className="card overflow-hidden" data-timeslot={slot.id} aria-labelledby={`ts-${slot.id}`}>
      <header className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <h2 id={`ts-${slot.id}`} className="num text-3xl font-extrabold">
            {time(slot.startsAt, l)} <span className="font-sans text-lg font-semibold tracking-normal">{named(slot.option, l)}</span>
          </h2>
          {resources.length > 0 && <p className="mt-1.5 text-sm text-muted">{resources.join(" · ")}</p>}
        </div>
        {closed ? (
          <Link href={`/o/${op}/timeslots/${slot.id}`} className="shrink-0 rounded-full bg-clay px-3 py-1.5 text-sm font-semibold text-white">
            {t.closedBadge(reason)}
          </Link>
        ) : (
          <p className="num shrink-0 text-right text-sm">
            <span className="font-display text-3xl font-extrabold">{tickets.length}</span> <span className="font-semibold">{t.booked}</span>
            <span className="block text-muted">{t.left(slot.spots)}</span>
          </p>
        )}
      </header>
      {slot.groups.map((g) => (
        <section key={g.bookingId ?? `${g.customerId}:${g.packId}`} className="border-t border-line px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">{g.contact.name}</p>
            {g.contact.phone && (
              <a
                href={`tel:${g.contact.phone}`}
                className="num -mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-leaf hover:bg-sand"
                aria-label={t.call(g.contact.name)}
              >
                <Icon name="phone" className="size-4" />
                {g.contact.phone}
              </a>
            )}
          </div>
          {g.addOns.length > 0 && (
            <p className="text-sm text-muted">
              {t.addOns}: {g.addOns.map((a) => `${named(a, l)} ×${a.quantity}`).join(" · ")}
            </p>
          )}
          <ul className="mt-2 space-y-2">
            {g.tickets.map((x) => {
              const queued = scans.find((s) => s.ticketId === x.id && s.state !== "rejected");
              const at = x.checkedInAt ?? (queued?.state === "done" ? queued.checkedInAt : null);
              return (
                <li key={x.id} data-ticket={x.code} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-lg leading-tight font-bold">{x.participant.name}</p>
                    <p className="num text-sm text-muted">
                      {[x.participant.age !== null && t.years(x.participant.age), x.participant.weightKg !== null && t.kg(x.participant.weightKg)]
                        .filter(Boolean)
                        .join(" · ")}
                      {x.resources.length > 0 && ` → ${x.resources.join(", ")}`}
                      <span className="font-mono"> · {x.code}</span>
                    </p>
                    <WaiverChip waiver={x.waiver} signer={x.signerName} />
                  </div>
                  {at ? (
                    <span className="num inline-flex shrink-0 items-center gap-1 rounded-full bg-lime px-3 py-1.5 text-sm font-semibold text-forest">
                      <Icon name="check" className="size-4" />
                      {t.checkedInAt(time(at, l))}
                    </span>
                  ) : queued ? (
                    <span className="shrink-0 rounded-full bg-sand px-3 py-1.5 text-sm font-semibold">{t.pending}</span>
                  ) : (
                    checkable &&
                    !closed && (
                      <button type="button" className="btn btn-quiet shrink-0 px-4 text-sm" onClick={() => onCheckIn(x)}>
                        {t.checkIn}
                      </button>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {!closed && (
        <Link
          href={`/o/${op}/timeslots/${slot.id}`}
          className="flex min-h-12 items-center justify-center border-t border-line text-sm font-semibold text-clay hover:bg-sand/50"
        >
          {slot.startsAt > Date.now() ? t.closeTimeslot : t.participants}
        </Link>
      )}
    </article>
  );
}
