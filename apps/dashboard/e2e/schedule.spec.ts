import { expect, test } from "@playwright/test";
import { day, fixture, newContext, shot, signIn } from "./helpers";

const weekday = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;

test("a Schedule generates Timeslots and skips Closed days", async ({ browser, request }) => {
  const fx = await fixture(request);
  const page = await (await newContext(browser)).newPage();
  await signIn(page, fx.email);
  await page.getByRole("link", { name: "Schedule" }).click();

  await page.getByRole("button", { name: "New Schedule" }).click();
  const sheet = page.getByRole("dialog", { name: "New Schedule" });
  await sheet.getByLabel("Trail ride").check();
  await expect(sheet.getByRole("button", { name: "Every day" })).toHaveAttribute("aria-pressed", "true");
  await sheet.getByRole("button", { name: "Add time" }).click();
  await sheet.getByLabel("Add time").fill("11:00");
  await sheet.getByRole("button", { name: "Add time" }).click();
  await expect(sheet.getByRole("button", { name: /^Remove/ })).toHaveText(["09:00", "11:00"]);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Added [1-9]\d* · Removed 0/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Trail ride/ })).toContainText("Every day · 09:00, 11:00");

  let first = day(2);
  while (!(weekday(first) === 0 && Number(first.slice(8)) <= 7)) first = new Date(Date.parse(first) + 86_400_000).toISOString().slice(0, 10);
  const second = new Date(Date.parse(first) + 7 * 86_400_000).toISOString().slice(0, 10);
  const weeks = Math.round((Date.parse(first) - Date.parse(day()) + weekday(day()) * 86_400_000) / (7 * 86_400_000));
  for (let i = 0; i < weeks; i++) await page.getByRole("button", { name: "Next week" }).click();

  const closed = page.locator(`[data-date="${first}"]`);
  await expect(closed).toHaveAttribute("data-closed", "true");
  await expect(closed).toContainText("Closed day");
  await expect(closed.locator("[data-chip]")).toHaveCount(0);
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(page.locator(`[data-date="${second}"] [data-chip]`)).toHaveCount(2);
  await shot(page, "schedule");
  await page.getByRole("button", { name: "Previous week" }).click();

  await page.getByRole("button", { name: "Add one-off Timeslot" }).click();
  const oneOff = page.getByRole("dialog", { name: "Add one-off Timeslot" });
  await oneOff.getByLabel("Date").fill(first);
  await oneOff.getByLabel("Time").fill("15:00");
  await expect(oneOff.getByRole("alert")).toHaveText("This is a Closed day. Add anyway?");
  await oneOff.getByRole("button", { name: "Add anyway" }).click();
  await expect(closed.locator("[data-chip]")).toHaveCount(1);
  await expect(closed.locator("[data-chip]")).toContainText("15:00 Trail ride");
});
