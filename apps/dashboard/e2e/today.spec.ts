import { expect, test } from "@playwright/test";
import { fixture, newContext, noAxeViolations, shot, signIn } from "./helpers";

test("Today lists Participants with age, weight, horse, Waiver, Add-ons and contact", async ({ browser, request }) => {
  const fx = await fixture(request);
  const page = await (await newContext(browser)).newPage();
  await signIn(page, fx.email);

  const card = page.locator(`[data-timeslot="${fx.timeslotId}"]`);
  await expect(card).toContainText("Trail ride");
  await expect(card).toContainText("Helmet ×1");
  await expect(card.getByRole("link", { name: "Call Aisyah Rahman" })).toHaveAttribute("href", "tel:+60123456789");

  const adult = card.locator(`[data-ticket="${fx.codes[0]}"]`);
  await expect(adult).toContainText("Aisyah Rahman");
  await expect(adult).toContainText(/\d{2} y · 62 kg → (Bayu|Kilat)/);
  await expect(adult.locator("[data-waiver]")).toHaveText("Waiver signed");

  const child = card.locator(`[data-ticket="${fx.codes[1]}"]`);
  await expect(child).toContainText("Adam Rahman");
  await expect(child).toContainText(/\d{2} y · 30 kg → (Bayu|Kilat)/);
  await expect(child.locator("[data-waiver]")).toHaveText("Signed by guardian Aisyah Rahman");

  await noAxeViolations(page);
  await shot(page, "today");

  await child.getByRole("button", { name: "Check in" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Check in" }).click();
  await expect(child).toContainText(/Checked in \d{2}:\d{2}/);
  await page.reload();
  await expect(child).toContainText(/Checked in \d{2}:\d{2}/);
});
