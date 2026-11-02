import { useState, type ReactNode } from "react";
import { ApiError } from "./api";
import { errorText, useT, type Dict } from "./i18n";
import { Field } from "./ui";

export type Err = { field?: string; text: string } | null;

// An unparseable value is sent as typed so the API rejects it on the right field.
export const num = (s: string) => (s.trim() === "" ? null : Number.isFinite(Number(s)) ? Number(s) : s);

export function useSubmit(t: Dict) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Err>(null);
  async function submit(fn: () => Promise<unknown>, onConflict?: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError({ field: (e as ApiError).field, text: onConflict && e instanceof ApiError && e.status === 409 ? onConflict : errorText(e, t) });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, submit, err: (f: string) => (error?.field === f ? error.text : undefined) };
}

export function SaveBar({ busy, error, onSave }: { busy: boolean; error: Err; onSave: () => void }) {
  const { t } = useT();
  return (
    <div className="sticky bottom-0 -mx-4 mt-6 border-t border-line bg-paper px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      {error && !error.field && (
        <p role="alert" className="mb-3 font-semibold text-clay">
          {error.text}
        </p>
      )}
      <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={onSave}>
        {t.save}
      </button>
    </div>
  );
}

export function Input({
  label,
  value,
  onChange,
  error,
  hint,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  numeric?: boolean;
}) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(id, note) => (
        <input
          id={id}
          className={`input ${numeric ? "num" : ""}`}
          inputMode={numeric ? "decimal" : undefined}
          value={value}
          aria-describedby={note}
          aria-invalid={!!error || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 font-display text-xl font-extrabold">{title}</legend>
      {children}
    </fieldset>
  );
}
