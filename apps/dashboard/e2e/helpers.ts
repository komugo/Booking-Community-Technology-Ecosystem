import AxeBuilder from "@axe-core/playwright";
import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { encode } from "uqr";

export const API = process.env.API_URL ?? "http://localhost:8790";
export const SHOTS = process.env.SHOTS;

export type Fixture = {
  operatorId: string;
  activityId: string;
  optionId: string;
  timeslotId: string;
  ticketIds: string[];
  codes: string[];
  email: string;
  staffEmail?: string;
  bookingId: string;
  k: string;
  customerEmail: string;
};
type Email = { to: string; subject: string; text: string };

export async function fixture(request: APIRequestContext, o: { locale?: "en" | "ms"; staff?: boolean; inWindow?: boolean } = {}): Promise<Fixture> {
  const res = await request.post(`${API}/dev/fixture`, { data: o });
  expect(res.ok()).toBe(true);
  return res.json();
}

export async function emails(request: APIRequestContext) {
  return (await (await request.get(`${API}/dev/emails`)).json()) as Email[];
}

// Each context gets its own client IP, so the per-IP sign-in limit never trips across tests.
export async function newContext(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}) {
  return browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
    baseURL: process.env.DASH_URL ?? "http://localhost:5180",
    extraHTTPHeaders: { "x-client-ip": `10.9.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}` },
    ...options,
  });
}

export async function signIn(page: Page, email: string, path = "/") {
  await page.goto(path);
  await expect(page).toHaveURL(/\/sign-in/);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  let code = "";
  for (let i = 0; i < 20 && !code; i++) {
    code = (await emails(page.request)).find((e) => e.to === email)?.text.match(/\b\d{6}\b/)?.[0] ?? "";
    if (!code) await page.waitForTimeout(250);
  }
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

export async function noAxeViolations(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

export async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}-375.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/${name}-1440.png` });
  await page.setViewportSize({ width: 375, height: 812 });
}

export const day = (offset = 0) => new Date(Date.now() + 8 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);

// A single-frame Y4M showing `text` as a QR code, for Chromium's fake camera.
export function writeY4m(text: string, path: string) {
  const W = 640;
  const H = 480;
  const MODULE = 8;
  const QUIET = 4;
  const { data } = encode(text, { border: 0 });
  const n = data.length;
  const side = (n + QUIET * 2) * MODULE;
  const x0 = (W - side) / 2;
  const y0 = (H - side) / 2;
  const y = Buffer.alloc(W * H, 235);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (data[r][c])
        for (let dy = 0; dy < MODULE; dy++)
          y.fill(
            16,
            (y0 + (r + QUIET) * MODULE + dy) * W + x0 + (c + QUIET) * MODULE,
            (y0 + (r + QUIET) * MODULE + dy) * W + x0 + (c + QUIET + 1) * MODULE,
          );
  const uv = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  writeFileSync(path, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\nFRAME\n`), y, uv]));
}

// Cancels Tickets as the Customer would: signed in, or with the emailed link `k` for a Closure choice.
export async function customerCancel(request: APIRequestContext, fx: Fixture, t: string, viaLink = false) {
  const headers = { "x-client-ip": `10.8.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}` };
  if (!viaLink) {
    expect((await request.post(`${API}/auth/sign-in`, { data: { email: fx.customerEmail }, headers })).status()).toBe(204);
    let code = "";
    for (let i = 0; i < 20 && !code; i++) {
      code = (await emails(request)).filter((e) => e.to === fx.customerEmail).at(-1)?.text.match(/\b\d{6}\b/)?.[0] ?? "";
      if (!code) await new Promise((r) => setTimeout(r, 250));
    }
    expect((await request.post(`${API}/auth/sign-in/verify`, { data: { email: fx.customerEmail, code }, headers })).status()).toBe(204);
  }
  const k = viaLink ? fx.k : undefined;
  const quote = await (await request.get(`${API}/bookings/${fx.bookingId}/quote?t=${encodeURIComponent(t)}${k ? `&k=${k}` : ""}`, { headers })).json();
  const res = await request.post(`${API}/bookings/${fx.bookingId}/cancel`, {
    headers,
    data: { requestId: crypto.randomUUID(), t, expectSen: quote.refundSen, expectForfeited: [], k },
  });
  expect(res.ok()).toBe(true);
  return res.json();
}
