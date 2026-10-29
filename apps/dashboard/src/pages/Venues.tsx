import { WEEKDAYS } from "@komugo/types/rules";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Link } from "wouter";
import { api, useApi } from "../api";
import { Input, num, SaveBar, useSubmit } from "../form";
import { errorText, named, useT } from "../i18n";
import { PhotosEditor } from "../photos";
import type { OpeningHours, Venue, Venues as VenueList } from "../types";
import { Field, Icon, LangPill, Sheet, Spinner, toast } from "../ui";

export default function Venues() {
  const { t, l } = useT();
  const list = useApi<VenueList>("/venues");
  const [editing, setEditing] = useState<{ item: Venue | null } | null>(null);
  const presint = (v: Venue) => (v.presint === null ? null : t.presintN(v.presint));

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
        <h1 className="text-4xl font-extrabold">{t.venues}</h1>
        {!list.data ? (
          list.error ? (
            <p className="py-16 text-center text-muted">{errorText(list.error, t)}</p>
          ) : (
            <Spinner label={t.loading} />
          )
        ) : (
          <>
            <button type="button" className="btn btn-primary mt-5" onClick={() => setEditing({ item: null })}>
              <Icon name="plus" className="size-5" />
              {t.newVenue}
            </button>
            {list.data.venues.length === 0 ? (
              <p className="mt-4 rounded-2xl bg-sand p-4">{t.noVenues}</p>
            ) : (
              <ul className="mt-4 grid gap-3 lg:grid-cols-2">
                {list.data.venues.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      data-row
                      onClick={() => setEditing({ item: v })}
                      className="card flex min-h-16 w-full flex-col items-start p-4 text-left hover:bg-sand/40"
                    >
                      <span className="font-display text-lg font-bold">{named(v, l)}</span>
                      <span className="text-sm text-muted">
                        {[presint(v), v.lat === null ? t.noPin : t.mapPin, `${v.photos.length} ${t.photos.toLowerCase()}`].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Sheet open={!!editing} onClose={() => setEditing(null)} full title={editing?.item ? t.editVenue : t.newVenue}>
              {editing && (
                <VenueEditor
                  list={list.data}
                  item={editing.item}
                  onSaved={() => {
                    setEditing(null);
                    toast(t.saved);
                    list.reload();
                  }}
                />
              )}
            </Sheet>
          </>
        )}
      </main>
    </div>
  );
}

function VenueEditor({ list, item, onSaved }: { list: VenueList; item: Venue | null; onSaved: () => void }) {
  const { t, l } = useT();
  const [v, setV] = useState({
    cityId: item?.cityId ?? list.cities[0]?.id ?? "",
    nameEn: item?.nameEn ?? "",
    nameMs: item?.nameMs ?? "",
    streetAddress: item?.streetAddress ?? "",
    postalCode: item?.postalCode ?? "",
    presint: item?.presint === null || !item ? "" : String(item.presint),
    phone: item?.phone ?? "",
    lat: item?.lat === null || !item ? "" : String(item.lat),
    lng: item?.lng === null || !item ? "" : String(item.lng),
    openingHours: item?.openingHours ?? [],
    photos: item?.photos ?? [],
  });
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const { busy, error, submit, err } = useSubmit(t);

  const save = async () => {
    const body = {
      cityId: v.cityId,
      nameEn: v.nameEn,
      nameMs: v.nameMs,
      streetAddress: v.streetAddress.trim() || null,
      postalCode: v.postalCode.trim() || null,
      presint: num(v.presint),
      phone: v.phone.trim() || null,
      lat: num(v.lat),
      lng: num(v.lng),
      openingHours: v.openingHours,
      photos: v.photos,
    };
    if (await submit(() => api(item ? "PUT" : "POST", `/venues${item ? `/${item.id}` : ""}`, body))) onSaved();
  };

  return (
    <div className="space-y-6">
      {list.cities.length > 1 && (
        <Field label={t.city}>
          {(id) => (
            <select id={id} className="input" value={v.cityId} onChange={(e) => set({ cityId: e.target.value })}>
              {list.cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {named(c, l)}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t.nameEn} value={v.nameEn} onChange={(nameEn) => set({ nameEn })} error={err("nameEn")} />
        <Input label={t.nameMs} value={v.nameMs} onChange={(nameMs) => set({ nameMs })} error={err("nameMs")} />
      </div>
      <Input label={t.streetAddress} value={v.streetAddress} onChange={(streetAddress) => set({ streetAddress })} error={err("streetAddress")} />
      <div className="grid grid-cols-2 gap-4">
        <Input label={t.postalCode} value={v.postalCode} onChange={(postalCode) => set({ postalCode })} error={err("postalCode")} numeric />
        <Field label={t.presint} error={err("presint")}>
          {(id, note) => (
            <select id={id} className="input" value={v.presint} aria-describedby={note} onChange={(e) => set({ presint: e.target.value })}>
              <option value="">–</option>
              {Array.from({ length: 20 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {t.presintN(i + 1)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Input label={t.phone} value={v.phone} onChange={(phone) => set({ phone })} error={err("phone")} hint={t.optional} />
      <fieldset>
        <legend className="label">{t.mapPin}</legend>
        <p id="pin-hint" className={`mb-2 text-sm ${err("lat") ? "font-semibold text-clay" : "text-muted"}`}>
          {err("lat") ?? t.mapPinHint}
        </p>
        <PinMap
          lat={Number.isFinite(parseFloat(v.lat)) ? parseFloat(v.lat) : null}
          lng={Number.isFinite(parseFloat(v.lng)) ? parseFloat(v.lng) : null}
          onPick={(lat, lng) => set({ lat: String(lat), lng: String(lng) })}
        />
        <div className="mt-3 grid grid-cols-2 gap-4">
          <Input label={t.latitude} value={v.lat} onChange={(lat) => set({ lat })} numeric />
          <Input label={t.longitude} value={v.lng} onChange={(lng) => set({ lng })} numeric />
        </div>
        {(v.lat || v.lng) && (
          <button type="button" className="btn btn-quiet mt-3" onClick={() => set({ lat: "", lng: "" })}>
            {t.removePin}
          </button>
        )}
      </fieldset>
      <HoursEditor hours={v.openingHours} onChange={(openingHours) => set({ openingHours })} error={err("openingHours")} />
      <PhotosEditor photos={v.photos} onChange={(fn) => setV((x) => ({ ...x, photos: fn(x.photos) }))} error={err("photos")} />
      <SaveBar busy={busy} error={error} onSave={save} />
    </div>
  );
}

function HoursEditor({ hours, onChange, error }: { hours: OpeningHours[]; onChange: (h: OpeningHours[]) => void; error?: string }) {
  const { t } = useT();
  const patch = (i: number, p: Partial<OpeningHours>) => onChange(hours.map((h, j) => (j === i ? { ...h, ...p } : h)));
  return (
    <fieldset>
      <legend className="label">{t.openingHours}</legend>
      <ul className="space-y-3">
        {hours.map((h, i) => (
          <li key={i} data-hours className="space-y-3 border-b border-line pb-3">
            <div className="grid grid-cols-7 gap-1.5">
              {WEEKDAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className="chip min-w-0 px-0"
                  aria-pressed={h.days.includes(d)}
                  aria-label={t.dayNames[d]}
                  onClick={() => patch(i, { days: h.days.includes(d) ? h.days.filter((x) => x !== d) : WEEKDAYS.filter((x) => x === d || h.days.includes(x)) })}
                >
                  {t.dayShort[d]}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-3">
              <Field label={t.opens}>
                {(id) => <input id={id} type="time" step={900} className="input num" value={h.opens} onChange={(e) => patch(i, { opens: e.target.value })} />}
              </Field>
              <Field label={t.closes}>
                {(id) => <input id={id} type="time" step={900} className="input num" value={h.closes} onChange={(e) => patch(i, { closes: e.target.value })} />}
              </Field>
              <button
                type="button"
                className="ml-auto flex size-12 shrink-0 items-center justify-center rounded-full hover:bg-sand"
                aria-label={t.removeHours}
                onClick={() => onChange(hours.filter((_, j) => j !== i))}
              >
                <Icon name="x" className="size-5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="mt-1 text-sm font-semibold text-clay">{error}</p>}
      <button type="button" className="btn btn-quiet mt-3" onClick={() => onChange([...hours, { days: [], opens: "08:00", closes: "22:00" }])}>
        <Icon name="plus" className="size-5" />
        {t.addHours}
      </button>
    </fieldset>
  );
}

const TILE = 256;
const HEIGHT = 256;
const PUTRAJAYA = { lat: 2.9264, lng: 101.6964 };

const project = (lat: number, lng: number, z: number) => {
  const size = TILE * 2 ** z;
  const r = (lat * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * size, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * size };
};

const unproject = (x: number, y: number, z: number) => {
  const size = TILE * 2 ** z;
  const n = Math.PI - (2 * Math.PI * y) / size;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng: (x / size) * 360 - 180 };
};

const round = (n: number) => Math.round(n * 1e6) / 1e6;

// OpenStreetMap tiles: tap drops the pin, drag pans.
function PinMap({ lat, lng, onPick }: { lat: number | null; lng: number | null; onPick: (lat: number, lng: number) => void }) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(lat === null ? 13 : 16);
  const [center, setCenter] = useState(lat !== null && lng !== null ? { lat, lng } : PUTRAJAYA);

  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const c = project(center.lat, center.lng, zoom);
  const left = c.x - width / 2;
  const top = c.y - HEIGHT / 2;
  const n = 2 ** zoom;
  const tiles: { x: number; y: number }[] = [];
  for (let x = Math.floor(left / TILE); x <= Math.floor((left + width) / TILE); x++) {
    for (let y = Math.max(0, Math.floor(top / TILE)); y <= Math.min(n - 1, Math.floor((top + HEIGHT) / TILE)); y++) tiles.push({ x, y });
  }
  const pin = lat !== null && lng !== null ? project(lat, lng, zoom) : null;

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    setCenter((p) => {
      const at = project(p.lat, p.lng, zoom);
      return unproject(at.x - dx, at.y - dy, zoom);
    });
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const r = e.currentTarget.getBoundingClientRect();
    const at = unproject(left + e.clientX - r.left, top + e.clientY - r.top, zoom);
    onPick(round(at.lat), round(at.lng));
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-sand" style={{ height: HEIGHT }}>
      <div
        ref={ref}
        data-map
        aria-describedby="pin-hint"
        className="absolute inset-0 cursor-crosshair touch-none select-none"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => (drag.current = null)}
      >
        {tiles.map(({ x, y }) => (
          <img
            key={`${zoom}/${x}/${y}`}
            alt=""
            draggable={false}
            src={`https://tile.openstreetmap.org/${zoom}/${((x % n) + n) % n}/${y}.png`}
            className="pointer-events-none absolute size-64 max-w-none"
            style={{ left: x * TILE - left, top: y * TILE - top }}
          />
        ))}
        {pin && (
          <span
            data-pin
            aria-hidden="true"
            className="pointer-events-none absolute size-5 -translate-1/2 rounded-full border-3 border-white bg-clay shadow"
            style={{ left: pin.x - left, top: pin.y - top }}
          />
        )}
      </div>
      <div className="absolute top-2 right-2 flex flex-col gap-1">
        {(
          [
            [t.zoomIn, "+", 1],
            [t.zoomOut, "−", -1],
          ] as const
        ).map(([label, sign, dz]) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            disabled={zoom + dz < 5 || zoom + dz > 19}
            onClick={() => setZoom(zoom + dz)}
            className="flex size-11 items-center justify-center rounded-full bg-white text-xl font-bold shadow disabled:opacity-50"
          >
            {sign}
          </button>
        ))}
      </div>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="absolute right-1 bottom-1 rounded bg-white/80 px-1 text-[0.6875rem] text-ink"
      >
        © OpenStreetMap
      </a>
    </div>
  );
}
