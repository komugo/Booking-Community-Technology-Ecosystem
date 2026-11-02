import { expect, test } from "@playwright/test";
import { emails, fixture, noAxeViolations, open, shot } from "./helpers";

test("a close link from today's list asks a reason, counts the Customers, closes once and shows who closed it", async ({ browser, request }) => {
  const fx = await fixture(request);
  const { context, page } = await open(browser);
  await page.goto(fx.list);
  const slot = page.locator(`[data-slot="${fx.timeslotId}"]`);
  await slot.getByRole("link", { name: "Close this time" }).click();

  await expect(page.locator("main h1")).toHaveText("Close a time");
  await expect(page.locator("[data-customers]")).toHaveText("1 Customer will be emailed to choose a refund or a new time.");
  await expect(page.getByLabel("Horse unfit")).toBeVisible();
  await noAxeViolations(page);
  await shot(page, "close-link");
  await page.getByLabel("Weather").check();
  await page.getByRole("button", { name: "Close and email customers" }).click();
  await expect(page.getByRole("status")).toHaveText("Closed by Siti. Customers are being emailed.");

  const mine = async () => (await emails(page)).filter((e) => e.to === fx.customerEmail && e.subject.startsWith("Timeslot closed:"));
  await expect.poll(async () => (await mine()).length).toBe(1);

  await page.goto(fx.list);
  await expect(slot).toContainText("Closed by Siti");
  await expect(slot.getByRole("link", { name: "Close this time" })).toHaveCount(0);

  const again = await request.post(fx.close, { form: { reason: "weather" }, headers: { Origin: new URL(fx.close).origin } });
  expect(again.ok()).toBe(true);
  expect(await again.text()).toContain("Closed by Siti.");
  expect(await mine()).toHaveLength(1);
  expect((await page.goto(fx.close.replace("k=", "k=zz")))?.status()).toBe(404);
  await context.close();
});
