import { expect, test } from "@playwright/test";
import { customerCancel, emails, fixture, newContext, shot, signIn } from "./helpers";

test("closing a booked Timeslot emails the customer once, even after an offline retry", async ({ browser, request }) => {
  const fx = await fixture(request, { locale: "ms" });
  const context = await newContext(browser);
  const page = await context.newPage();
  await signIn(page, fx.email);

  await page.locator(`[data-timeslot="${fx.timeslotId}"]`).getByRole("link", { name: "Close Timeslot" }).click();
  await expect(page).toHaveURL(`/o/${fx.operatorId}/timeslots/${fx.timeslotId}`);
  await page.getByRole("button", { name: "Close Timeslot" }).click();
  const sheet = page.getByRole("dialog", { name: "Close Timeslot" });
  await sheet.getByText("Weather").click();
  await expect(sheet.locator("[data-summary]")).toContainText("2 people in 1 Booking will be emailed");

  await context.setOffline(true);
  await sheet.getByRole("button", { name: "Close and email customers" }).click();
  await expect(sheet.getByRole("alert")).toHaveText("No connection, nothing was closed. Try again.");
  await context.setOffline(false);
  await sheet.getByRole("button", { name: "Close and email customers" }).click();

  await expect(page.getByText(/Closed \(Weather\) at \d{2}:\d{2}/)).toBeVisible();
  const affected = page.locator("[data-affected]");
  await expect(affected).toHaveCount(1);
  await expect(affected).toContainText("Aisyah Rahman");
  await expect(affected).toContainText("Awaiting choice");
  await expect(affected.locator("[data-email]")).toHaveText(/Email sent \d{2}:\d{2}/, { timeout: 15_000 });
  await shot(page, "closure");

  const to = `cust+${fx.operatorId.slice(3)}@example.com`;
  const mine = async () => (await emails(request)).filter((e) => e.to === to && e.subject.startsWith("Slot masa ditutup:"));
  expect(await mine()).toHaveLength(1);
  await page.getByRole("button", { name: "Re-send emails" }).click();
  await page.waitForTimeout(1000);
  expect(await mine()).toHaveLength(1);

  await customerCancel(request, fx, `closed:${fx.timeslotId}`, true);
  // The choice reaches D1 through the outbox a moment after the cancel.
  await expect(async () => {
    await page.reload();
    await expect(affected).toContainText("Chose refund", { timeout: 1000 });
  }).toPass();
  await expect(affected).not.toContainText("Awaiting choice");

  await page.getByRole("link", { name: "Today" }).first().click();
  await expect(page.locator(`[data-timeslot="${fx.timeslotId}"]`)).toContainText("Closed · Weather");
});
