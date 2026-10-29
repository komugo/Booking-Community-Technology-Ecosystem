import { expect, test } from "@playwright/test";
import { fixture, newContext, noAxeViolations, shot, signIn } from "./helpers";

test("operator manages Resources, Options, Add-ons and Closed days", async ({ browser, request }) => {
  const fx = await fixture(request);
  const page = await (await newContext(browser)).newPage();
  await signIn(page, fx.email);
  await page.getByRole("link", { name: "Setup" }).click();

  await page.getByRole("tab", { name: "Resources" }).click();
  await page.getByRole("button", { name: "New Resource" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name", { exact: true }).fill("Melati");
  await sheet.getByLabel("Max sessions a day").fill("4");
  await sheet.getByLabel("Rest between sessions (min)").fill("20");
  await sheet.getByLabel("Max rider weight (kg)").fill("85");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("[data-row]", { hasText: "Melati" })).toContainText("≤85 kg · 4/day · rest 20 min");
  await expect(page.locator("[data-row]", { hasText: "Bayu" })).toContainText("≤90 kg · 6/day · rest 15 min");
  await noAxeViolations(page);
  await shot(page, "resources");

  await page.getByRole("tab", { name: "Options" }).click();
  await page.getByRole("button", { name: "New Option" }).click();
  await sheet.getByLabel("Name (English)").fill("Pony ride");
  await sheet.getByLabel("Name (BM)").fill("Tunggang kuda padi");
  await sheet.getByLabel("Price (RM)").fill("120");
  await sheet.getByLabel("Duration (min)").fill("45");
  await sheet.getByRole("button", { name: "Min participants +" }).click();
  await sheet.getByRole("button", { name: "Horse +" }).click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("[data-row]", { hasText: "Pony ride" })).toContainText("RM120 · 45 min · 1× Horse");

  await page.getByRole("tab", { name: "Add-ons" }).click();
  await page.getByRole("button", { name: "New Add-on" }).click();
  await sheet.getByLabel("Name (English)").fill("Gloves");
  await sheet.getByLabel("Name (BM)").fill("Sarung tangan");
  await sheet.getByLabel("Price (RM)").fill("abc");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByText("Check this value.")).toBeVisible();
  await sheet.getByLabel("Price (RM)").fill("7.50");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("[data-row]", { hasText: "Gloves" })).toContainText("RM7.50");

  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.locator("[data-listing-mode]")).toHaveText("Hidden");
  await expect(page.getByLabel("Listing mode")).toHaveCount(0);
  const sentence = page.locator("[data-closed-sentence]");
  await expect(sentence).toHaveText("Closed 1st and 3rd Monday");
  await page.getByRole("button", { name: "Remove 1st Monday" }).click();
  await page.getByRole("button", { name: "Remove 3rd Monday" }).click();
  await expect(sentence).toHaveText("Open every day");
  await page.getByLabel("Closed days", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "Add Closed day" }).click();
  await page.getByLabel("Days", { exact: true }).selectOption("Su");
  await page.getByLabel("Closed days", { exact: true }).selectOption("");
  await page.getByRole("button", { name: "Add Closed day" }).click();
  await expect(sentence).toHaveText("Closed 2nd Monday, every Sunday");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.reload();
  await expect(sentence).toHaveText("Closed 2nd Monday, every Sunday");
});

test("only staff can set Listing mode, and Bookable needs a Commission", async ({ browser, request }) => {
  const fx = await fixture(request, { staff: true });
  const page = await (await newContext(browser)).newPage();
  await signIn(page, fx.staffEmail!, `/o/${fx.operatorId}/setup`);
  await expect(page).toHaveURL(`/o/${fx.operatorId}/setup`);
  const mode = page.getByLabel("Listing mode");
  await expect(mode).toHaveValue("hidden");
  await mode.selectOption("bookable");
  await expect(page.getByText("Set the Commission before making an Activity Bookable.")).toBeVisible();
  await expect(mode).toHaveValue("hidden");
  await page.getByLabel("Commission (%)").fill("12.5");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await Promise.all([page.waitForResponse((r) => r.url().endsWith("/listing-mode") && r.ok()), mode.selectOption("bookable")]);
  await page.reload();
  await expect(page.getByLabel("Listing mode")).toHaveValue("bookable");
});
