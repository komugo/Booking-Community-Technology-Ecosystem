import { expect, test } from "@playwright/test";
import { bar, fixture, inbox, noAxeViolations, open, shot } from "./helpers";

const link = (text: string, kind = "bookings") => text.match(new RegExp(`https?://\\S+/${kind}/\\S+`))![0];

test("from the Closure email, a signed-out Customer moves to another time", async ({ browser, request }) => {
  const fx = await fixture(request, { inWindow: true, extraSlots: 1, close: true });
  const { context, page } = await open(browser);
  await page.goto(link((await inbox(page, fx.customerEmail, /\/bookings\//)).text));
  const banner = page.locator(`[data-closure="${fx.timeslotId}"]`);
  await expect(banner).toContainText("closed Trail ride on");
  await expect(banner.getByRole("link", { name: "Full refund RM165" })).toBeVisible();
  await noAxeViolations(page);
  await shot(page, "closure-choice");

  await banner.getByRole("link", { name: "Move to another time, free" }).click();
  await expect(page.locator("main h1")).toHaveText("Move Aisyah Rahman and Adam Rahman's session");
  await bar(page).click();
  await expect(page.getByRole("status")).toHaveText(/^Moved to /);
  await expect(page.locator(`[data-closure="${fx.timeslotId}"]`)).toHaveText("You chose a new time. It's shown below.");
  await expect(page.locator(`[data-visit="${fx.extraSlotIds[0]}"] svg[role=img]`)).toHaveCount(2);
  await context.close();
});

test("from the Closure email, a Customer takes the full refund (ms)", async ({ browser, request }) => {
  const fx = await fixture(request, { locale: "ms", inWindow: true, close: true });
  const { context, page } = await open(browser);
  const url = link((await inbox(page, fx.customerEmail, /\/bookings\//)).text);
  expect(url).toContain("/ms/bookings/");
  await page.goto(url);
  await page.locator(`[data-closure="${fx.timeslotId}"]`).getByRole("link", { name: "Bayaran balik penuh RM165" }).click();
  await expect(page.locator("[data-outcome=cancelled]")).toHaveCount(2);
  await expect(page.locator("[data-outcome=cancelled]").first()).toContainText("Bayaran balik penuh: pengendali menutup sesi ini.");
  await page.locator("[data-confirm]").click();
  await expect(page.getByRole("status")).toHaveText("Dibatalkan. RM165 sedang diproses (dalam 7 hari bekerja).");
  await page.goto(url);
  await expect(page.locator(`[data-closure="${fx.timeslotId}"]`)).toHaveText(
    "Anda memilih bayaran balik penuh RM165. Ia akan diterima dalam 7 hari bekerja.",
  );
  await context.close();
});

test("from the Closure email, a Pack Customer gets the sessions back", async ({ browser, request }) => {
  const fx = await fixture(request, { inWindow: true, viaPack: true, close: true });
  const { context, page } = await open(browser);
  await page.goto(link((await inbox(page, fx.customerEmail, /\/packs\//)).text, "packs"));
  await expect(page.locator("[data-left]")).toHaveText("2 of 4 left");
  const banner = page.locator(`[data-closure="${fx.timeslotId}"]`);
  await banner.getByRole("link", { name: "Return 2 sessions to my Pack" }).click();
  await expect(page.locator("[data-outcome=cancelled]")).toHaveCount(2);
  await page.locator("[data-confirm]").click();
  await expect(page.locator(`[data-closure="${fx.timeslotId}"]`)).toHaveText("You chose to get the sessions back in your Pack.");
  await expect(page.locator("[data-left]")).toHaveText("4 of 4 left");
  await context.close();
});
