import { expect, test } from "@playwright/test";
import { klHours } from "../src/lib/i18n";
import { emails, fixture, noAxeViolations, open, shot } from "./helpers";

test("Day list link shows the day's Tickets without Sign-in; a tampered link is refused", async ({ browser, request }) => {
  const fx = await fixture(request);
  const { context, page } = await open(browser);
  await page.goto(fx.list);
  await expect(page.locator("main h1")).toHaveText("Day list");
  const slot = page.locator(`[data-slot="${fx.timeslotId}"]`);
  await expect(slot).toContainText("Trail ride");
  await expect(slot).toContainText(`Aisyah Rahman: ${fx.codes.join(", ")}`);
  await expect(page.locator("[data-future]")).toHaveCount(0);
  await noAxeViolations(page);
  await shot(page, "day-list");

  expect((await page.goto(fx.list.replace("k=", "k=zz")))?.status()).toBe(404);
  await context.close();
});

test("Day list in BM", async ({ browser, request }) => {
  const fx = await fixture(request, { locale: "ms", close: true });
  const { context, page } = await open(browser);
  expect(fx.list).toContain("/ms/list/");
  await page.goto(fx.list);
  await expect(page.locator("main h1")).toHaveText("Senarai harian");
  const slot = page.locator(`[data-slot="${fx.timeslotId}"]`);
  await expect(slot).toContainText("Ditutup");
  await expect(slot.getByText("Tutup masa ini")).toHaveCount(0);
  await noAxeViolations(page);
  await context.close();
});

test("on the day, closing a time from the Day list asks a reason, counts the Customers, closes once and shows who closed it", async ({ browser, request }) => {
  const fx = await fixture(request);
  const { context, page } = await open(browser);
  await page.goto(fx.list);
  const slot = page.locator(`[data-slot="${fx.timeslotId}"]`);
  await slot.getByText("Close this time").click();
  await expect(slot.locator("[data-customers]")).toHaveText("1 Customer will be emailed to choose a refund or a new time.");
  await expect(slot.getByLabel("Horse unfit")).toBeVisible();
  await noAxeViolations(page);
  await shot(page, "day-list-close");
  await slot.getByLabel("Weather").check();
  await slot.getByRole("button", { name: "Close and email customers" }).click();
  await expect(slot).toContainText("Closed by Siti");
  await expect(slot.getByText("Close this time")).toHaveCount(0);

  const mine = async () => (await emails(page)).filter((e) => e.to === fx.customerEmail && e.subject.startsWith("Timeslot closed:"));
  await expect.poll(async () => (await mine()).length).toBe(1);

  const again = await request.post(fx.list, { form: { timeslot: fx.timeslotId, reason: "weather" }, headers: { Origin: new URL(fx.list).origin } });
  expect(again.ok()).toBe(true);
  expect(await again.text()).toContain("Closed by Siti");
  expect(await mine()).toHaveLength(1);
  const tampered = fx.list.replace("k=", "k=zz");
  expect((await request.post(tampered, { form: { timeslot: fx.timeslotId, reason: "weather" }, headers: { Origin: new URL(fx.list).origin } })).status()).toBe(404);
  await context.close();
});

test("a future day's Day list shows a per-court Ticket once with its court and hours, and Date tickets by name, with no close action", async ({ browser, request }) => {
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
  await expect(page.locator("[data-future]")).toHaveText("You can close a time here on the day itself.");
  await expect(page.locator("details")).toHaveCount(0);
  await noAxeViolations(page);
  await shot(page, "day-list-court-date");
  const late = await request.post(x.list, { form: { timeslot: x.dateSlotId, reason: "weather" }, headers: { Origin: new URL(x.list).origin } });
  expect(await late.text()).toContain("so it can no longer be closed here");
  await context.close();
});
