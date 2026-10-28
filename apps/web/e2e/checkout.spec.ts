import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { API, bar, email, inbox, noAxeViolations, open, prefix, SHOTS, type Locale } from "./helpers";

const DIST = join(import.meta.dirname, "../dist");

async function pickTime(page: Page, l: Locale, optionId: string, people = 1, minSpots = 1) {
  await page.goto(`${prefix(l)}/book/${optionId}`);
  const day = page.locator("a[data-day]").nth(Math.floor(Math.random() * 6) + 2);
  if (await day.count()) await day.click();
  const slot = page.locator(`label:has(input[name=timeslotId]${Array.from({ length: minSpots - 1 }, (_, i) => `:not([data-spots="${i + 1}"])`).join("")})`).first();
  await slot.click();
  for (let i = 1; i < people; i++) await page.locator('[data-for="quantity"][data-by="1"]').click();
}

async function person(page: Page, i: number, name: string, [dd, mm, yyyy]: string[], o: { weight?: string; guardian?: string } = {}) {
  const card = page.locator("[data-person]").nth(i);
  await card.locator('[data-f="name"]').fill(name);
  await card.locator('[data-f="dd"]').fill(dd);
  await card.locator('[data-f="mm"]').fill(mm);
  await card.locator('[data-f="yyyy"]').fill(yyyy);
  if (o.weight) await card.locator('[data-f="weight"]').fill(o.weight);
  await card.locator('input[type="checkbox"]').check();
  if (o.guardian) await card.locator("input[name$='.guardianName']").fill(o.guardian);
}

async function signIn(page: Page, to: string) {
  await expect(page).toHaveURL(/\/contact$/);
  await page.fill("#name", "Aina Rahman");
  await page.fill("#email", to);
  await page.locator('button[value="send"]').click();
  const otp = (await inbox(page, to, /\d{6}/)).text.match(/\d{6}/)![0];
  await page.fill("#code", otp);
  await page.locator('button[value="verify"]').click();
}

async function toPay(page: Page, l: Locale, to = email(l)) {
  await pickTime(page, l, "opt_cp_adult");
  await bar(page).click();
  await person(page, 0, "Pay Tester", ["01", "02", "1990"]);
  await bar(page).click();
  await signIn(page, to);
  await expect(page).toHaveURL(/\/pay$/);
  return to;
}

test.beforeAll(async ({ request }) => {
  expect((await request.post(`${API}/dev/seed`)).ok()).toBe(true);
});

for (const locale of ["en", "ms"] as const) {
  test(`guest books 2 people with an add-on, then returns signed in (${locale})`, async ({ browser }) => {
    const { context, page } = await open(browser);
    const shot = async (name: string) => {
      await noAxeViolations(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${locale}-${name}.png`, fullPage: true });
    };
    const to = email(locale);

    await page.goto("/putrajaya/rock-climbing/putrajaya-challenge-park");
    if (locale === "ms") await page.locator('nav[aria-label="Language"] a[hreflang="ms"]').click();
    await expect(page.locator("#sticky-cta a")).toHaveAttribute("href", "#options");
    await shot("00-activity");
    await page.locator("#option-opt_cp_adult a").click();

    await expect(page.locator("ol[aria-label]")).toHaveAttribute("aria-label", /1/);
    await page.locator("a[data-day]").nth(5).click();
    await page.locator('label:has(input[name=timeslotId]:not([data-spots="1"]):not([data-spots="2"]))').first().click();
    await page.locator('[data-for="quantity"][data-by="1"]').click();
    await page.locator('[data-for="addOn-addon_cp_shoes"][data-by="1"]').click();
    await expect(page.locator("[data-total]")).toHaveText("RM19");
    await page.locator("a[data-day]").nth(Math.floor(Math.random() * 6) + 6).click();
    await expect(page.locator("#quantity")).toHaveValue("2");
    await expect(page.locator("#addOn-addon_cp_shoes")).toHaveValue("1");
    await page.locator('label:has(input[name=timeslotId]:not([data-spots="1"]):not([data-spots="2"]))').first().click();
    await shot("01-pick");
    await bar(page).click();

    await expect(page).toHaveURL(/\/who$/);
    await bar(page).click();
    await expect(page.locator("#error-summary")).toBeFocused();
    await expect(page.locator("#error-summary")).toContainText(locale === "ms" ? "Orang 1" : "Person 1");
    await shot("02-who-errors");

    await person(page, 0, "Aina Rahman", ["12", "03", "1990"]);
    await expect(page.locator('[id="participants.0.name"]')).not.toHaveAttribute("aria-invalid");
    await person(page, 1, "Adam Rahman", ["05", "06", "2012"]);
    const second = page.locator("[data-person]").nth(1);
    await expect(second.locator("input[name$='.guardianName']")).toBeVisible();
    await expect(second.locator("input[name$='.signedAs']")).toHaveValue("minor");
    await expect(page.locator("[data-person]").nth(0).locator("input[name$='.guardianName']")).toBeHidden();
    await bar(page).click();
    await expect(page.locator("#error-summary")).toContainText("Adam Rahman");
    await expect(second.locator('input[type="checkbox"]')).toBeChecked();
    await second.locator("input[name$='.guardianName']").fill("Aina Rahman");
    await shot("03-who");
    await bar(page).click();

    await expect(page).toHaveURL(/\/contact$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/who$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/contact$/);
    await page.fill("#name", "Aina Rahman");
    await page.fill("#email", to);
    await shot("04-contact");
    await page.locator('button[value="send"]').click();
    const otp = (await inbox(page, to, /\d{6}/)).text.match(/\d{6}/)![0];
    await page.fill("#code", otp);
    await shot("05-otp");
    await page.locator('button[value="verify"]').click();

    await expect(page).toHaveURL(/\/pay$/);
    await expect(page.locator("[data-expires]")).toContainText(/\d+:\d\d/);
    await expect(page.locator("[data-bar] [data-total]")).toHaveText("RM19");
    await expect(page.locator("section[aria-labelledby=summary] p.text-muted")).toHaveText("Aina Rahman, Adam Rahman");
    await shot("06-pay");
    await page.locator("[data-pay]").click();
    await expect(page).toHaveURL(/\/dev\/billplz\/bills\//);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${locale}-07-billplz.png`, fullPage: true });
    await page.locator('button[value="pay"]').click();

    await expect(page).toHaveURL(/\/bookings\/[^?]+\?k=/);
    const qrs = page.locator("svg[role=img]");
    await expect(qrs).toHaveCount(2);
    expect((await qrs.first().boundingBox())!.width).toBeGreaterThanOrEqual(200);
    await shot("08-ticket");

    const booked = await inbox(page, to, /\/bookings\//);
    const link = booked.text.match(/https?:\/\/\S+\/bookings\/\S+/)![0];
    const guest = await open(browser);
    await guest.page.goto(link);
    await expect(guest.page.locator("svg[role=img]")).toHaveCount(2);
    await guest.context.close();

    await page.goto(`${prefix(locale)}/book/opt_cp_adult`);
    await page.locator("a[data-day]").nth(12).click();
    await page.locator('label:has(input[name=timeslotId]:not([data-spots="1"]))').first().click();
    await bar(page).click();
    await expect(page).toHaveURL(/\/who$/);
    const card = page.locator("[data-person]").nth(0);
    await card.locator("[data-fill]", { hasText: "Aina Rahman" }).click();
    await expect(card.locator('[data-f="name"]')).toHaveValue("Aina Rahman");
    await expect(card.locator("[data-fill]").first()).toBeVisible();
    await expect(card.locator("[data-fill]", { hasText: "Aina Rahman" })).toHaveText("Aina Rahman");
    await expect(card.locator("[data-signed-badge]")).toBeVisible();
    await expect(card.locator("[data-waiver]")).toBeHidden();
    await shot("09-who-saved");
    await bar(page).click();
    await expect(page).toHaveURL(/\/pay$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/who$/);
    await bar(page).click();
    await expect(page).toHaveURL(/\/pay$/);
    await expect(page.locator("#error-summary")).toHaveCount(0);
    await context.close();
  });
}

test("a minor needs a guardian; too young and overweight get inline errors", async ({ browser }) => {
  const { context, page } = await open(browser);
  await pickTime(page, "en", "opt_eq_joy_adult", 2);
  await bar(page).click();
  await person(page, 0, "Heavy Rider", ["01", "01", "1985"], { weight: "95" });
  await person(page, 1, "Young Rider", ["01", "01", String(new Date().getFullYear() - 10)], { weight: "30" });
  await bar(page).click();
  await expect(page.locator('[id="participants.0.weightKg"]')).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator('[id="participants.0.weightKg-error"]')).toContainText("80 kg");
  await expect(page.locator('[id="participants.1.birthDate-error"]')).toContainText("at least 13");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/en-10-who-requirements.png`, fullPage: true });

  await person(page, 0, "Heavy Rider", ["01", "01", "1985"], { weight: "70" });
  await person(page, 1, "Teen Rider", ["01", "01", String(new Date().getFullYear() - 15)], { weight: "50" });
  await bar(page).click();
  await expect(page.locator('[id="participants.1.guardianName-error"]')).toBeVisible();
  await noAxeViolations(page);
  await context.close();
});

test("the group Option can't be booked below its minimum", async ({ browser }) => {
  const { context, page } = await open(browser);
  await pickTime(page, "en", "opt_eq_group_lesson");
  await expect(page.locator("#quantity")).toHaveValue("2");
  await expect(page.locator('[data-for="quantity"][data-by="-1"]')).toBeDisabled();
  await page.locator("#quantity").evaluate((el: HTMLInputElement) => (el.value = "1"));
  await bar(page).click();
  await expect(page.locator("#error-summary")).toContainText("groups of 2 or more");
  await context.close();
});

test("the last spots race: one browser gets no_availability", async ({ browser }) => {
  const a = await open(browser);
  const b = await open(browser);
  await a.page.goto("/book/opt_eq_private_lesson");
  await a.page.locator("a[data-day]").nth(Math.floor(Math.random() * 10) + 2).click();
  await a.page.locator('label:has(input[name=timeslotId][data-spots="2"])').first().click();
  const slot = await a.page.locator("input[name=timeslotId]:checked").getAttribute("value");
  await a.page.locator('[data-for="quantity"][data-by="1"]').click();
  await b.page.goto(a.page.url());
  await b.page.locator(`label:has(input[value="${slot}"])`).click();
  await b.page.locator('[data-for="quantity"][data-by="1"]').click();
  for (const [i, x] of [a, b].entries()) {
    await bar(x.page).click();
    await person(x.page, 0, `Rider A${i}`, ["01", "01", "1990"], { weight: "60" });
    await person(x.page, 1, `Rider B${i}`, ["02", "01", "1990"], { weight: "60" });
    await bar(x.page).click();
    await expect(x.page).toHaveURL(/\/contact$/);
    await x.page.fill("#name", "Rider");
    const to = email(`race${i}`);
    await x.page.fill("#email", to);
    await x.page.locator('button[value="send"]').click();
    await x.page.fill("#code", (await inbox(x.page, to, /\d{6}/)).text.match(/\d{6}/)![0]);
  }
  await Promise.all([a, b].map((x) => x.page.locator('button[value="verify"]').click()));
  await Promise.all([a, b].map((x) => x.page.waitForURL(/\/(pay|opt_eq_private_lesson\?e=\w+)$/)));
  expect([a, b].filter((x) => /\/pay$/.test(x.page.url()))).toHaveLength(1);
  const lost = [a, b].find((x) => !/\/pay$/.test(x.page.url()))!;
  await expect(lost.page).toHaveURL(/\/book\/opt_eq_private_lesson\?e=no_availability$/);
  await expect(lost.page.locator("#error-summary")).toContainText("aren't enough spots");
  if (SHOTS) await lost.page.screenshot({ path: `${SHOTS}/en-13-pick-no-availability.png`, fullPage: true });
  await a.context.close();
  await b.context.close();
});

test("a failed payment retries the same bill", async ({ browser }) => {
  const { context, page } = await open(browser);
  await toPay(page, "en");
  await page.locator("[data-pay]").click();
  const bill = page.url();
  await page.locator('button[value="fail"]').click();
  await expect(page).toHaveURL(/\/pay\?e=payment_failed$/);
  await expect(page.locator("#error-summary")).toContainText("weren't charged");
  await expect(page.locator("[data-pay]")).toHaveText("Try again");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/en-11-pay-failed.png`, fullPage: true });
  await page.locator("[data-pay]").click();
  expect(page.url()).toBe(bill);
  await context.close();
});

test("a pending payment confirms once paid", async ({ browser }) => {
  const { context, page } = await open(browser);
  await toPay(page, "ms");
  await page.locator("[data-pay]").click();
  const bill = page.url();
  await page.locator('button[value="pending"]').click();
  await expect(page.locator("h1")).toHaveText("Mengesahkan bayaran…");
  // The spec'd no-JS fallback refreshes every 3 s for at most 60 s.
  await noAxeViolations(page, ["meta-refresh"]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ms-12-return-pending.png`, fullPage: true });
  const other = await context.newPage();
  await other.goto(bill);
  await other.locator('button[value="pay_no_return"]').click();
  await expect(page).toHaveURL(/\/ms\/bookings\/[^?]+\?k=/, { timeout: 15_000 });
  await context.close();
});

test("paid without a return, the email link shows the Tickets", async ({ browser }) => {
  const { context, page } = await open(browser);
  const to = await toPay(page, "en");
  await page.locator("[data-pay]").click();
  await page.locator('button[value="pay_no_return"]').click();
  const link = (await inbox(page, to, /\/bookings\//)).text.match(/https?:\/\/\S+\/bookings\/\S+/)![0];
  const guest = await open(browser);
  await guest.page.goto(link);
  await expect(guest.page.locator("svg[role=img]")).toHaveCount(1);
  await guest.context.close();
  await context.close();
});

test("a forged return shows the error page", async ({ page }) => {
  await page.goto(`/checkout/return?billplz[id]=nope&billplz[paid]=true&billplz[paid_at]=x&billplz[x_signature]=${"0".repeat(64)}`);
  await expect(page.locator("h1")).toHaveText("There's a problem");
  await expect(page.locator("main")).toContainText("couldn't verify");
});

test("POSTs need our Origin, except the Billplz callback", async ({ request, baseURL }) => {
  const form = { form: { timeslotId: "x", quantity: "1" } };
  expect((await request.post("/book/opt_cp_adult", { ...form, headers: { Origin: "https://evil.test" } })).status()).toBe(403);
  expect((await request.post("/book/opt_cp_adult", { ...form, headers: { Origin: "null" } })).status()).toBe(403);
  expect((await request.post("/book/opt_cp_adult", { ...form, headers: { Origin: baseURL! } })).status()).toBe(400);
  const callback = await request.post("/billplz/callback", { form: { id: "x", paid: "true" } });
  expect(await callback.text()).toContain("bad_signature");
});

test("the checkout's built JS is under 6 KB", () => {
  const entry = join(DIST, "server/entry.mjs");
  test.skip(!existsSync(entry), "run `pnpm build` first");
  const m = /layouts\/Checkout\.astro\?astro&type=script[^"]*","((?:[^"\\]|\\.)*)"/.exec(readFileSync(entry, "utf8"));
  expect(m).not.toBeNull();
  expect(Buffer.byteLength(JSON.parse(`"${m![1]}"`))).toBeLessThan(6 * 1024);
});
