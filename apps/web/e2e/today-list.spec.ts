import { expect, test } from "@playwright/test";
import { klHours } from "../src/lib/i18n";
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

test("today's list shows a per-court Ticket once with its court and hours, and Date tickets by name; closing the date closes them", async ({ browser, request }) => {
  const fx = await fixture(request, { court: true, dateTicket: true, listed: true });
  const x = fx.listed!;
  const { context, page } = await open(browser);
  await page.goto(x.list);
  const court = page.locator(`[data-slot="${x.courtSlotId}"]`);
  await expect(court).toContainText(/Court hire/);
  const hours = klHours("en", { startsAt: x.courtStartsAt, endsAt: x.courtStartsAt + 2 * 3_600_000 });
  await expect(court).toContainText(new RegExp(`Court [AB], ${hours} · Aisyah Rahman: ${x.courtCode}`));
  await expect(page.locator("[data-slot]").filter({ hasText: x.courtCode })).toHaveCount(1);

  const day = page.locator(`[data-slot="${x.dateSlotId}"]`);
  await expect(day.locator("h2")).toHaveText("Day pass · 2 tickets");
  await expect(day).toContainText(`Aisyah Rahman: Aisyah Rahman ${x.dateCodes[0]}, Adam Rahman ${x.dateCodes[1]}`);
  await noAxeViolations(page, ["meta-refresh"]);
  await shot(page, "today-list-court-date");

  await day.getByRole("link", { name: "Close this date" }).click();
  await expect(page.locator("main h1")).toHaveText("Close a date");
  await expect(page.locator("[data-customers]")).toHaveText("1 Customer will be emailed to choose a refund or a new time.");
  await page.getByLabel("Maintenance").check();
  await page.getByRole("button", { name: "Close and email customers" }).click();
  await expect(page.getByRole("status")).toHaveText("Closed by Siti. Customers are being emailed.");

  await page.goto(x.list);
  await expect(day).toContainText("Closed by Siti");
  await expect(day).not.toContainText(x.dateCodes[0]);
  await context.close();
});
