import { createDb, LEAD_PACKAGES, leads } from "@komugo/db";
import { Hono } from "hono";
import { clientIp, normEmail, validEmail } from "./auth";
import { html, sendEmail } from "./email";
import { fail, limited, logError, requireJson } from "./lib";
import { invalid, json } from "./ops/input";
import { sender } from "./whatsapp";

export const digital = new Hono<{ Bindings: Env }>();

type Lead = typeof leads.$inferInsert;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const line = (v: unknown) => str(v).replace(/\s+/g, " ");
const optional = (v: unknown) => line(v) || null;
const fits = (v: string | null, max: number) => v === null || v.length <= max;
const oneOf = <T extends string>(v: unknown, values: readonly T[]) => (values.includes(v as T) ? (v as T) : null);

// Typed locally (012-345 6789) or with a country code; stored as +60123456789.
function whatsapp(v: unknown) {
  const d = str(v).replace(/[\s()-]/g, "").replace(/^00/, "+");
  const n = d.startsWith("+") ? d.slice(1) : d.startsWith("0") ? `6${d}` : d;
  return /^\d{9,15}$/.test(n) ? `+${n}` : null;
}

async function human(env: Env, token: unknown, ip: string) {
  if (typeof token !== "string" || !token) return false;
  if (env.DEV_SEED === "1" && token === "dev") return true;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    return ((await res.json()) as { success?: unknown }).success === true;
  } catch (e) {
    logError("turnstile_failed", { error: String(e) });
    return false;
  }
}

const alert = (l: Lead & { id: string }) =>
  [
    `Komugo Digital: new ${l.kind === "proposal" ? "Proposal request" : "quote request"}${l.packageId ? ` (${l.packageId})` : ""}`,
    [
      `Name: ${l.name}`,
      l.company && `Company: ${l.company}`,
      l.agency && `Agency: ${l.agency}`,
      `Email: ${l.email}`,
      `WhatsApp: ${l.whatsapp}`,
      l.budget && `Budget: ${l.budget}`,
      l.procurement && `Procurement: ${l.procurement}`,
      l.timeline && `Timeline: ${l.timeline}`,
      `From: ${l.sourcePage} (${l.locale})`,
    ]
      .filter(Boolean)
      .join("\n"),
    l.brief,
  ].join("\n\n");

function confirmation(l: Lead & { id: string }) {
  const ms = l.locale === "ms";
  const what = ms ? (l.kind === "proposal" ? "permintaan cadangan" : "permintaan sebut harga") : l.kind === "proposal" ? "proposal request" : "quote request";
  const lines = ms
    ? [
        "Hai,",
        `Terima kasih kerana menghubungi Komugo Digital. Kami telah menerima ${what} anda.`,
        "Kami akan meneliti keperluan anda dan menghubungi anda melalui e-mel atau WhatsApp.",
      ]
    : [
        "Hi,",
        `Thanks for contacting Komugo Digital. We've received your ${what}.`,
        "We'll read through what you need and get back to you by email or WhatsApp.",
      ];
  return {
    to: l.email,
    subject: ms ? `Kami telah menerima ${what} anda` : `We've received your ${what}`,
    text: lines.join("\n\n"),
    html: html(lines),
    idempotencyKey: `lead:${l.id}`,
  };
}

digital.post("/leads", requireJson, async (c) => {
  const ip = clientIp(c);
  if (await limited(c.env.RL_IP, `lead:${ip}`)) return fail(c, 429, { code: "rate_limited" });
  const body = await json(c);
  const v = {
    kind: oneOf(body.kind, ["quote", "proposal"] as const),
    packageId: optional(body.packageId),
    name: line(body.name),
    company: optional(body.company),
    email: normEmail(body.email),
    whatsapp: whatsapp(body.whatsapp),
    budget: optional(body.budget),
    brief: str(body.brief),
    agency: optional(body.agency),
    procurement: optional(body.procurement),
    timeline: optional(body.timeline),
    sourcePage: line(body.sourcePage),
    locale: oneOf(body.locale, ["en", "ms"] as const),
  };
  const errors = invalid([
    [v.kind !== null, "kind"],
    [v.packageId === null || oneOf(v.packageId, LEAD_PACKAGES) !== null, "packageId"],
    [v.name.length >= 1 && v.name.length <= 200, "name"],
    [fits(v.company, 200), "company"],
    [validEmail(v.email), "email"],
    [v.whatsapp !== null, "whatsapp"],
    [fits(v.budget, 100), "budget"],
    [v.brief.length >= 10 && v.brief.length <= 4000, "brief"],
    [fits(v.agency, 200), "agency"],
    [v.procurement === null || oneOf(v.procurement, ["direct", "quotation", "tender"] as const) !== null, "procurement"],
    [fits(v.timeline, 100), "timeline"],
    [v.sourcePage.length >= 1 && v.sourcePage.length <= 200, "sourcePage"],
    [v.locale !== null, "locale"],
  ]);
  if (errors.length) return fail(c, 400, errors[0], errors);
  if (!(await human(c.env, body.turnstileToken, ip))) return fail(c, 403, { code: "turnstile_failed" });

  const [lead] = await createDb(c.env.DB)
    .insert(leads)
    .values({ ...(v as Lead), createdAt: Date.now() })
    .returning();
  if (c.env.STAFF_WHATSAPP) {
    c.executionCtx.waitUntil(
      sender(c.env)
        .send({ to: c.env.STAFF_WHATSAPP, text: alert(lead) })
        .catch((e) => logError("lead_whatsapp_failed", { leadId: lead.id, error: String(e) })),
    );
  }
  c.executionCtx.waitUntil(sendEmail(c.env, confirmation(lead)).catch((e) => logError("lead_email_failed", { leadId: lead.id, error: String(e) })));
  return c.body(null, 204);
});
