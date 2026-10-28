import { klDate } from "@komugo/types/rules";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { api, ApiError } from "../api";
import { dateLong, errorText, named, time, useT } from "../i18n";
import type { ClosureReason, Group, Timeslot } from "../types";
import { Icon, Sheet, Spinner, WaiverChip } from "../ui";

const REASONS: ClosureReason[] = ["weather", "horse_unfit", "other"];

export default function TimeslotPage() {
  const { t, l } = useT();
  const { op, id } = useParams<{ op: string; id: string }>();
  const [slot, setSlot] = useState<Timeslot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ClosureReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { timeslots } = await api<{ timeslots: Timeslot[] }>("GET", `/operators/${op}/timeslots/${id}`);
      setSlot(timeslots[0]);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorText(e, t));
    }
  }, [op, id, t]);

  useEffect(() => {
    load();
  }, [load]);

  const sending = slot?.groups.some((g) => g.notice && !g.notice.emailedAt);
  useEffect(() => {
    if (!sending) return;
    const timer = setTimeout(load, 2000);
    return () => clearTimeout(timer);
  }, [sending, slot, load]);

  async function close(r: ClosureReason) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ timeslot: Timeslot }>("POST", `/operators/${op}/timeslots/${id}/close`, { reason: r });
      setSlot(res.timeslot);
      setOpen(false);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 0 ? t.closeOffline : e instanceof ApiError && e.code === "invalid_state" ? t.started : errorText(e, t),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!slot) return loadError ? <p className="py-16 text-center text-muted">{loadError}</p> : <Spinner label={t.loading} />;

  const date = klDate(slot.startsAt);
  const tickets = slot.groups.flatMap((g) => g.tickets);
  const closedReason = (REASONS.includes(slot.closedReason as ClosureReason) ? slot.closedReason : "other") as ClosureReason;

  return (
    <>
      <Link
        href={`/o/${op}/today?d=${date}`}
        className="-ml-3 inline-flex min-h-11 items-center gap-1 rounded-full pr-3 pl-1 font-semibold text-leaf hover:bg-sand"
      >
        <Icon name="back" className="size-5" />
        {t.today}
      </Link>
      <p className="mt-2 text-sm font-semibold text-muted">{dateLong(slot.startsAt, l)}</p>
      <h1 className="num mt-1 text-4xl font-extrabold">
        {time(slot.startsAt, l)} · {named(slot.option, l)}
      </h1>

      {slot.closedAt ? (
        <>
          <p className="mt-4 rounded-xl bg-clay px-4 py-3 font-semibold text-white">{t.closedOn(t.reasons[closedReason], time(slot.closedAt, l))}</p>
          {slot.groups.length > 0 && (
            <section className="mt-6" aria-labelledby="affected">
              <div className="flex items-center justify-between gap-3">
                <h2 id="affected" className="text-2xl font-extrabold">
                  {t.affected}
                </h2>
                <button type="button" className="btn btn-quiet px-4 text-sm" disabled={busy} onClick={() => close(closedReason)}>
                  {t.resendEmails}
                </button>
              </div>
              {error && (
                <p role="alert" className="mt-3 font-semibold text-clay">
                  {error}
                </p>
              )}
              <ul className="mt-3 space-y-3">
                {slot.groups.map((g) => (
                  <li key={g.bookingId ?? `${g.customerId}:${g.packId}`} className="card p-4" data-affected>
                    <Contact g={g} />
                    <p className="mt-2 text-sm">{g.tickets.map((x) => x.participant.name).join(", ")}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-sm font-semibold">
                      <span className="rounded-full bg-sand px-3 py-1">{t.awaiting}</span>
                      <span data-email className={`num rounded-full px-3 py-1 ${g.notice?.emailedAt ? "bg-lime/40 text-forest" : "bg-sand"}`}>
                        {g.notice?.emailedAt ? t.emailSent(time(g.notice.emailedAt, l)) : t.emailSending}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <>
          <section className="mt-6" aria-labelledby="people">
            <h2 id="people" className="text-2xl font-extrabold">
              {t.participants}
            </h2>
            {slot.groups.length === 0 ? (
              <p className="mt-3 text-muted">{t.noParticipants}</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {slot.groups.map((g) => (
                  <li key={g.bookingId ?? `${g.customerId}:${g.packId}`} className="card p-4">
                    <Contact g={g} />
                    <ul className="mt-2 space-y-2">
                      {g.tickets.map((x) => (
                        <li key={x.id}>
                          <span className="font-semibold">{x.participant.name}</span>
                          {x.resources.length > 0 && <span className="text-muted"> → {x.resources.join(", ")}</span>}
                          <br />
                          <WaiverChip waiver={x.waiver} signer={x.signerName} />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {slot.startsAt > Date.now() && (
            <button
              type="button"
              className="btn btn-danger mt-8 w-full sm:w-auto"
              onClick={() => {
                setError(null);
                setOpen(true);
              }}
            >
              {t.closeTimeslot}
            </button>
          )}
        </>
      )}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t.closeTimeslot}
        footer={
          <>
            {error && (
              <p role="alert" className="mb-3 font-semibold text-clay">
                {error}
              </p>
            )}
            <button type="button" className="btn btn-danger w-full" disabled={!reason || busy} onClick={() => reason && close(reason)}>
              {t.closeConfirm}
            </button>
          </>
        }
      >
        <fieldset>
          <legend className="label">{t.whyClose}</legend>
          <div className="grid grid-cols-3 gap-2">
            {REASONS.map((r) => (
              <label
                key={r}
                className="flex min-h-16 cursor-pointer items-center justify-center rounded-2xl border border-line bg-white px-2 text-center font-semibold has-checked:border-forest has-checked:bg-forest has-checked:text-white has-focus-visible:outline-3 has-focus-visible:outline-lime"
              >
                <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="sr-only" />
                {t.reasons[r]}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="mt-4 font-semibold text-clay" data-summary>
          {tickets.length ? t.affectedSummary(tickets.length, slot.groups.length) : t.nobodyBooked}
        </p>
        {reason === "horse_unfit" && <p className="mt-3 rounded-xl bg-sand px-4 py-3 text-sm">{t.horseHint}</p>}
      </Sheet>
    </>
  );
}

function Contact({ g }: { g: Group }) {
  const { t } = useT();
  return (
    <div>
      <p className="font-display text-lg font-bold">{g.contact.name}</p>
      <div className="-ml-2 flex flex-wrap text-sm font-semibold text-leaf">
        {g.contact.phone && (
          <a
            href={`tel:${g.contact.phone}`}
            aria-label={t.call(g.contact.name)}
            className="num inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 hover:bg-sand"
          >
            <Icon name="phone" className="size-4" />
            {g.contact.phone}
          </a>
        )}
        {g.contact.email && (
          <a href={`mailto:${g.contact.email}`} className="inline-flex min-h-11 items-center rounded-full px-2 break-all hover:bg-sand">
            {g.contact.email}
          </a>
        )}
      </div>
    </div>
  );
}
