import { expect, test } from "@playwright/test";
import { afterReload, fixture, newContext, noAxeViolations, shot, signIn, whatsappTo } from "./helpers";

test("staff add an Operator contact, who gets the Welcome in their language, then edit and remove it", async ({ browser, request }) => {
  const fx = await fixture(request, { staff: true });
  const page = await (await newContext(browser)).newPage();
  await signIn(page, fx.staffEmail!, `/o/${fx.operatorId}/setup?tab=contacts`);
  await expect(page.locator("[data-row]")).toHaveText([/Siti/]);

  const number = `01${String(Date.now()).slice(-8)}`;
  await page.getByRole("button", { name: "New contact" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name", { exact: true }).fill("Encik Hafiz");
  await sheet.getByLabel("WhatsApp number").fill(number);
  await sheet.getByLabel("Role").selectOption("owner");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByText("Check this value.")).toBeVisible();
  await sheet.getByLabel("Email").fill("hafiz@example.com");
  await expect(sheet.getByLabel("Language")).toHaveValue("ms");
  await sheet.getByRole("button", { name: "Save" }).click();

  const row = page.locator("[data-row]", { hasText: "Encik Hafiz" });
  await expect(row).toContainText(`+6${number} · Owner · BM · hafiz@example.com`);
  await afterReload(page, () => expect(row).toContainText("Welcome sent", { timeout: 1_000 }));
  expect(await whatsappTo(request, `+6${number}`)).toContain("Salam Encik Hafiz, ini Komugo.");
  await noAxeViolations(page);
  await shot(page, "contacts");

  await row.click();
  await sheet.getByLabel("Role").selectOption("counter");
  await sheet.getByLabel("Language").selectOption("en");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(row).toContainText(`+6${number} · Counter · English`);
  await expect(row).not.toContainText("hafiz@example.com");

  await row.click();
  await sheet.getByRole("button", { name: "Remove contact" }).click();
  await expect(row).toHaveCount(0);
});
