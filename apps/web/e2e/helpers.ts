import AxeBuilder from "@axe-core/playwright";
import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";

export const API = process.env.API_URL ?? "http://localhost:8790";
export const SHOTS = process.env.SHOTS;

type Email = { to: string; subject: string; text: string };
export type Locale = "en" | "ms";
export type Fixture = {
  operatorId: string;
  optionId: string;
  timeslotId: string;
  extraSlotIds: string[];
  ticketIds: string[];
  codes: string[];
  bookingId: string;
  packId?: string;
  k: string;
  customerEmail: string;
  activityPath: string;
  offerId?: string;
};

export async function fixture(
  request: APIRequestContext,
  o: {
    locale?: Locale;
    inWindow?: boolean;
    packOffer?: boolean;
    packSessions?: number;
    packValidDays?: number;
    viaPack?: boolean;
    extraSlots?: number;
    close?: boolean;
  } = {},
): Promise<Fixture> {
  const res = await request.post(`${API}/dev/fixture`, { data: o });
  expect(res.ok()).toBe(true);
  return res.json();
}

export const emails = async (page: Page) => (await (await page.request.get(`${API}/dev/emails`)).json()) as Email[];

export async function inbox(page: Page, to: string, match: RegExp, after = 0) {
  for (let i = 0; i < 20; i++) {
    const mail = (await emails(page)).filter((e) => e.to === to && match.test(e.text))[after];
    if (mail) return mail;
    await page.waitForTimeout(500);
  }
  throw new Error(`no email for ${to}`);
}

export async function noAxeViolations(page: Page, disable: string[] = []) {
  const r = await new AxeBuilder({ page }).exclude("astro-dev-toolbar").disableRules(disable).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

export async function open(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    extraHTTPHeaders: { "CF-Connecting-IP": `10.0.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}` },
  });
  const page = await context.newPage();
  await page.addInitScript(() =>
    addEventListener("DOMContentLoaded", () => document.head.insertAdjacentHTML("beforeend", "<style>astro-dev-toolbar{display:none!important}</style>")),
  );
  return { context, page };
}

export const prefix = (l: Locale) => (l === "ms" ? "/ms" : "");
export const email = (tag: string) => `e2e+${tag}${Date.now()}${Math.floor(Math.random() * 1e4)}@example.com`;
export const bar = (page: Page) => page.locator("[data-bar] button, [data-bar] a");
const CODE = /\b\d{6}\b/;

// Standalone Sign-in: lands on `next` once verified.
export async function signIn(page: Page, l: Locale, to: string, next: string) {
  await page.goto(`${prefix(l)}/sign-in?next=${encodeURIComponent(next)}`);
  await signInHere(page, to);
}

export async function signInHere(page: Page, to: string) {
  await expect(page).toHaveURL(/\/sign-in/);
  const before = (await emails(page)).filter((e) => e.to === to && CODE.test(e.text)).length;
  await page.fill("#email", to);
  await bar(page).click();
  const otp = (await inbox(page, to, CODE, before)).text.match(CODE)![0];
  await page.fill("#code", otp);
  await bar(page).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

export async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}-375.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/${name}-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
}
