import { expect, test } from "@playwright/test";
import { fixture, noAxeViolations, open, prefix, type Locale } from "./helpers";

for (const [l, labels] of [
  ["en", { bookable: "Bookable only", free: "Free", setting: "Indoor or outdoor", indoor: "Indoor", presint: "Presint", apply: "Show results", map: "Map" }],
  ["ms", { bookable: "Boleh ditempah sahaja", free: "Percuma", setting: "Dalam atau luar bangunan", indoor: "Dalam bangunan", presint: "Presint", apply: "Tunjuk hasil", map: "Peta" }],
] as [Locale, Record<string, string>][]) {
  test(`${l}: filters narrow the Putrajaya page and survive reload; the map pins the Venue`, async ({ browser, request }) => {
    const fx = await fixture(request, { info: true });
    const city = fx.activityPath.split("/")[1];
    const { context, page } = await open(browser);
    await page.goto(`${prefix(l)}/${city}`);
    const cards = page.locator("section[aria-labelledby=all] article");
    const filters = page.locator("[data-filters]");
    await expect(cards).toHaveCount(1);

    await filters.getByLabel(labels.free).check();
    await filters.getByLabel(labels.presint).selectOption("9");
    await filters.getByRole("button", { name: labels.apply }).click();
    await expect(page).toHaveURL(/free=1.*presint=9/);
    await expect(cards).toHaveCount(1);
    await page.reload();
    await expect(filters.getByLabel(labels.free)).toBeChecked();
    await expect(cards).toHaveCount(1);

    await filters.getByLabel(labels.setting).selectOption({ label: labels.indoor });
    await filters.getByRole("button", { name: labels.apply }).click();
    await expect(page).toHaveURL(/setting=indoor/);
    await expect(cards).toHaveCount(0);

    await filters.getByLabel(labels.setting).selectOption("");
    await filters.getByLabel(labels.bookable).check();
    await filters.getByRole("button", { name: labels.apply }).click();
    await expect(cards).toHaveCount(0);
    await filters.getByLabel(labels.bookable).uncheck();
    await filters.getByRole("button", { name: labels.apply }).click();

    await page.getByRole("link", { name: labels.map, exact: true }).click();
    await expect(page).toHaveURL(/free=1&presint=9&view=map/);
    await expect(page.locator("[data-pin]")).toHaveCount(1);
    await noAxeViolations(page);
    await page.reload();
    await expect(page.getByRole("link", { name: labels.map, exact: true })).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.locator("[data-pin]").click();
    await expect(page).toHaveURL(new RegExp(`/${l === "ms" ? "tempat" : "venue"}/${fx.venueSlug}$`));
    await context.close();
  });
}
