import { expect, test } from "@playwright/test";
import { fixture, newContext, noAxeViolations, shot, signIn } from "./helpers";

test("operator sets up a Pack offer", async ({ browser, request }) => {
  const fx = await fixture(request);
  const page = await (await newContext(browser)).newPage();
  await signIn(page, fx.email);
  await page.getByRole("link", { name: "Setup" }).click();
  await page.getByRole("tab", { name: "Packs" }).click();
  await page.getByRole("button", { name: "New Pack offer" }).click();

  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name (English)").fill("8 rides");
  await sheet.getByLabel("Name (BM)").fill("8 tunggangan");
  await sheet.getByRole("button", { name: "Sessions +" }).click();
  await sheet.getByLabel("Price (RM)").fill("520");
  await sheet.getByRole("button", { name: "90", exact: true }).click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.locator("#eligible-note")).toHaveText("Check this value.");
  await sheet.getByRole("checkbox", { name: /Trail ride/ }).check();
  await noAxeViolations(page);
  await shot(page, "dash-pack-offer-editor");
  await sheet.getByRole("button", { name: "Save" }).click();

  const row = page.locator("[data-row]", { hasText: "8 rides" });
  await expect(row).toContainText("5 sessions · RM520 · 90 days");
  await expect(row).toContainText("Trail ride");
  await shot(page, "dash-pack-offers");

  await row.click();
  await sheet.getByLabel("Price (RM)").fill("480");
  await sheet.getByText("Active", { exact: true }).click();
  await expect(sheet.getByRole("switch", { name: "Active" })).not.toBeChecked();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(row).toContainText("RM480");
  await expect(row).toContainText("Inactive");
});
