import { Input } from "./form";
import { useT } from "./i18n";
import type { Photo } from "./types";
import { Icon } from "./ui";

const UNSPLASH = /^https:\/\/images\.unsplash\.com\/[^\s?#]+$/;
const BLANK: Photo = { url: "", width: 0, height: 0, altEn: "", altMs: "", creditName: "", creditUrl: "", sourceUrl: "" };

type Update = (fn: (photos: Photo[]) => Photo[]) => void;

export function PhotosEditor({ photos, onChange, error }: { photos: Photo[]; onChange: Update; error?: string }) {
  const { t } = useT();
  const patch = (i: number, p: Partial<Photo>) => onChange((ps) => ps.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setUrl = (i: number, url: string) => {
    patch(i, { url });
    if (!UNSPLASH.test(url)) return;
    const img = new Image();
    img.onload = () => onChange((ps) => ps.map((x) => (x.url === url ? { ...x, width: img.naturalWidth, height: img.naturalHeight } : x)));
    img.src = url;
  };
  return (
    <fieldset>
      <legend className="label">{t.photos}</legend>
      <p className={`mb-3 text-sm ${error ? "font-semibold text-clay" : "text-muted"}`}>{error ?? t.photosHint}</p>
      <ol className="space-y-4">
        {photos.map((p, i) => (
          <li key={i} data-photo className="space-y-3 rounded-2xl border border-line bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              {UNSPLASH.test(p.url) ? (
                <img src={`${p.url}?w=240&q=60&fit=crop&auto=format`} alt="" className="h-20 w-28 rounded-xl bg-sand object-cover" />
              ) : (
                <span className="h-20 w-28 rounded-xl bg-sand" />
              )}
              <button
                type="button"
                className="-mr-1 flex size-11 items-center justify-center rounded-full hover:bg-sand"
                aria-label={`${t.removePhoto} ${i + 1}`}
                onClick={() => onChange((ps) => ps.filter((_, j) => j !== i))}
              >
                <Icon name="x" className="size-5" />
              </button>
            </div>
            <Input label={t.photoUrl} value={p.url} onChange={(url) => setUrl(i, url)} />
            <div className="grid grid-cols-2 gap-3">
              <Input label={t.widthPx} value={p.width ? String(p.width) : ""} onChange={(v) => patch(i, { width: Number(v) })} numeric />
              <Input label={t.heightPx} value={p.height ? String(p.height) : ""} onChange={(v) => patch(i, { height: Number(v) })} numeric />
            </div>
            <Input label={t.altEn} value={p.altEn} onChange={(altEn) => patch(i, { altEn })} />
            <Input label={t.altMs} value={p.altMs} onChange={(altMs) => patch(i, { altMs })} />
            <Input label={t.creditName} value={p.creditName} onChange={(creditName) => patch(i, { creditName })} />
            <Input label={t.creditUrl} value={p.creditUrl} onChange={(creditUrl) => patch(i, { creditUrl })} />
            <Input label={t.sourceUrl} value={p.sourceUrl} onChange={(sourceUrl) => patch(i, { sourceUrl })} />
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-quiet mt-3" disabled={photos.length >= 10} onClick={() => onChange((ps) => [...ps, BLANK])}>
        <Icon name="plus" className="size-5" />
        {t.addPhoto}
      </button>
    </fieldset>
  );
}
