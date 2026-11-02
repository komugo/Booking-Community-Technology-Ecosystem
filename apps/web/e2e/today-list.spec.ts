import { expect, test } from "@playwright/test";
import { fixture, noAxeViolations, open, shot } from "./helpers";

test("today's list link shows the day's Tickets without Sign-in; a tampered link is refused", async ({ browser, request }) => {
  const fx = await fixture(request);
  const { context, page } = await open(browser);
  await page.goto(fx.list);
  await expect(page.locator("main h1")).toHaveText("Today's list");
  const slot = page.locator(`[data-slot="${fx.timeslotId}"]`);
  await expect(slot).toContainText("Trail ride");
  await expect(slot).toContainText(`Aisyah Rahman: ${fx.codes.join(", ")}`);
  await noAxeViolations(page, ["meta-refresh"]);
  await shot(page, "today-list");

  expect((await page.goto(fx.list.replace("k=", "k=zz")))?.status()).toBe(404);
  await context.close();
});

test("today's list in BM", async ({ browser, request }) => {
  const fx = await fixture(request, { locale: "ms", close: true });
  const { context, page } = await open(browser);
  expect(fx.list).toContain("/ms/list/");
  await page.goto(fx.list);
  await expect(page.locator("main h1")).toHaveText("Senarai hari ini");
  await expect(page.locator(`[data-slot="${fx.timeslotId}"]`)).toContainText("Ditutup");
  await noAxeViolations(page, ["meta-refresh"]);
  await context.close();
});
