import { expect, test } from "@playwright/test";
import { day, fixture, newContext, noAxeViolations, shot, signIn } from "./helpers";

test("Public holidays are staff-only", async ({ browser, request }) => {
  const fx = await fixture(request);
  const page = await (await newContext(browser)).newPage();
  await signIn(page, fx.email, "/holidays");
  await expect(page.getByRole("heading", { name: "Nothing here" })).toBeVisible();
});

test("staff add and remove Public holidays, and give a Date ticket a Weekend price that the Operator can opt holidays into", async ({ browser, request }) => {
  const fx = await fixture(request, { staff: true });
  const page = await (await newContext(browser)).newPage();
  await signIn(page, fx.staffEmail!, "/holidays");
  const date = day(300);
  const name = `Hari Wilayah ${fx.operatorId}`;
  await page.getByLabel("Date", { exact: true }).fill("31-01-2027");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Check this value.")).toBeVisible();
  await page.getByLabel("Date", { exact: true }).fill(date);
  await page.getByRole("button", { name: "Save" }).click();
  const list = page.getByRole("list", { name: "Public holidays" });
  await expect(list).toContainText(name);
  await noAxeViolations(page);
  await shot(page, "holidays");
  await page.getByRole("button", { name: `Remove ${name}` }).click();
  await expect(page.getByText(name)).toHaveCount(0);

  await page.goto(`/o/${fx.operatorId}/setup`);
  const optIn = page.getByRole("switch", { name: "Public holidays at the Weekend price" });
  await expect(optIn).not.toBeChecked();
  await page.getByText("Public holidays at the Weekend price").click();
  await expect(optIn).toBeChecked();
  await page.reload();
  await expect(optIn).toBeChecked();

  await page.getByRole("tab", { name: "Options" }).click();
  await page.getByRole("button", { name: "New Option" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Ticket type").selectOption("date");
  await sheet.getByLabel("Name (English)").fill("Day pass");
  await sheet.getByLabel("Name (BM)").fill("Pas harian");
  await sheet.getByLabel("Price (RM)", { exact: true }).fill("15");
  await sheet.getByLabel("Weekend price (RM)").fill("25");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("[data-row]", { hasText: "Day pass" })).toContainText("RM15 · Weekend RM25");
});
