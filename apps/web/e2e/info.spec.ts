import { expect, test } from "@playwright/test";
import { fixture, noAxeViolations, open, prefix, type Locale } from "./helpers";

for (const [l, check] of [
  ["en", "Check with venue"],
  ["ms", "Semak dengan pihak tempat"],
] as [Locale, string][]) {
  test(`${l}: an Info Activity shows its Venue and "${check}" with no booking button`, async ({ browser, request }) => {
    const fx = await fixture(request, { info: true });
    const { context, page } = await open(browser);
    await page.goto(`${prefix(l)}${fx.activityPath}`);
    await expect(page.locator("[data-venue]")).toHaveText("Kompleks Sukan Presint 9 · Presint 9");
    await expect(page.locator("[data-price-note]")).toContainText(check);
    await expect(page.locator("[data-hours]")).toHaveText(check);
    await expect(page.locator("[data-cta=unknown]")).toContainText(check);
    await expect(page.locator('a[href*="/book/"]')).toHaveCount(0);
    await expect(page.locator("#options")).toHaveCount(0);
    await noAxeViolations(page);
    await context.close();
  });
}

for (const [l, segment, badge] of [
  ["en", "venue", "Info"],
  ["ms", "tempat", "Maklumat"],
] as [Locale, string, string][]) {
  test(`${l}: an Activity links to its Venue page, which lists it with its "${badge}" badge`, async ({ browser, request }) => {
    const fx = await fixture(request, { info: true });
    const { context, page } = await open(browser);
    await page.goto(`${prefix(l)}${fx.activityPath}`);
    const activityUrl = page.url();
    await page.locator("[data-venue] a").click();
    await expect(page).toHaveURL(new RegExp(`/${segment}/${fx.venueSlug}$`));
    await expect(page.locator("main h1")).toHaveText("Kompleks Sukan Presint 9");
    await expect(page.locator("[data-badge]")).toHaveText(badge);
    await expect(page.locator("main article a")).toHaveAttribute("href", new URL(activityUrl).pathname);
    await noAxeViolations(page);
    await context.close();
  });
}

for (const [l, sent] of [
  ["en", "We'll email you once"],
  ["ms", "Kami akan e-mel anda sekali"],
] as [Locale, string][]) {
  test(`${l}: an Info Activity takes an email to notify when bookable`, async ({ browser, request }) => {
    const fx = await fixture(request, { info: true });
    const { context, page } = await open(browser);
    await page.goto(`${prefix(l)}${fx.activityPath}`);
    const notify = page.locator("#notify");
    await notify.locator("input[name=email]").fill("nope");
    await notify.locator("button").click();
    await expect(notify.locator("#email-error")).toBeVisible();
    await expect(notify.locator("input[name=email]")).toHaveValue("nope");
    await notify.locator("input[name=email]").fill(`interest-${Date.now()}@example.com`);
    await notify.locator("button").click();
    await expect(notify.getByRole("status")).toContainText(sent);
    await noAxeViolations(page);
    await context.close();
  });
}
