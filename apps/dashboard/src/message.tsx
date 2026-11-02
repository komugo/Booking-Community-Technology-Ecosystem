import { useState } from "react";
import { api, useApi } from "./api";
import { useSubmit } from "./form";
import { errorText, useT } from "./i18n";
import type { Contact } from "./types";
import { Field, Sheet, Spinner, toast } from "./ui";

export function MessageSheet({ op, draft = "", open, onClose }: { op: string; draft?: string; open: boolean; onClose: () => void }) {
  const { t } = useT();
  return (
    <Sheet open={open} onClose={onClose} full title={t.messageContacts}>
      <Composer op={op} draft={draft} onSent={onClose} />
    </Sheet>
  );
}

function Composer({ op, draft, onSent }: { op: string; draft: string; onSent: () => void }) {
  const { t } = useT();
  const list = useApi<{ contacts: Contact[] }>(`/operators/${op}/contacts`);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [text, setText] = useState(draft);
  const { busy, error, submit, err } = useSubmit(t);

  if (!list.data) return list.error ? <p className="py-16 text-center text-muted">{errorText(list.error, t)}</p> : <Spinner label={t.loading} />;
  if (list.data.contacts.length === 0) return <p className="rounded-2xl bg-sand p-4">{t.noContacts}</p>;
  const contactIds = list.data.contacts.map((c) => c.id).filter((id) => !skipped.includes(id));

  const send = async () => {
    let res = { sent: 0, failed: 0 };
    if (!(await submit(async () => (res = await api("POST", `/operators/${op}/contacts/message`, { contactIds, text }))))) return;
    if (res.failed) toast(t.messageFailed(res.failed), "error");
    else toast(t.messageSent(res.sent));
    onSent();
  };

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="label">{t.messageTo}</legend>
        <ul className="space-y-2">
          {list.data.contacts.map((c) => (
            <li key={c.id}>
              <label className="card flex min-h-14 cursor-pointer items-center gap-3 px-4">
                <input
                  type="checkbox"
                  className="size-5 accent-forest"
                  checked={!skipped.includes(c.id)}
                  onChange={(e) => setSkipped(e.target.checked ? skipped.filter((id) => id !== c.id) : [...skipped, c.id])}
                />
                <span className="min-w-0">
                  <span className="block font-semibold">{c.name}</span>
                  <span className="num block text-sm text-muted">
                    {c.phone} · {t.contactRoles[c.role]}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <Field label={t.messageText} hint={t.messageHint} error={err("text")}>
        {(id, note) => (
          <textarea
            id={id}
            rows={5}
            className="input min-h-32 py-3"
            value={text}
            aria-describedby={note}
            aria-invalid={!!err("text") || undefined}
            onChange={(e) => setText(e.target.value)}
          />
        )}
      </Field>
      {error && !error.field && (
        <p role="alert" className="font-semibold text-clay">
          {error.text}
        </p>
      )}
      <button type="button" className="btn btn-primary w-full" disabled={busy || contactIds.length === 0 || !text.trim()} onClick={send}>
        {t.sendMessage}
      </button>
    </div>
  );
}
