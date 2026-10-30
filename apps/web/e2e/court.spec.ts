import { expect, test } from "@playwright/test";
import { bar, email, fixture, inbox, noAxeViolations, open, prefix } from "./helpers";

for (const locale of ["en", "ms"] as const) {
  test(`a guest books a court for 1 hour with no Who step and gets a Ticket showing the court (${locale})`, async ({ browser, request }) => {
    const f = await fixture(request, { court: true });
    const { context, page } = await open(browser);
    const to = email(`court-${locale}`);

    await page.goto(`${prefix(locale)}/book/${f.courtOptionId}`);
    await expect(page.locator("#people-label")).toHaveText(locale === "ms" ? "1 gelanggang untuk 1 jam" : "1 court for 1 hour");
    await expect(page.locator('[data-for="quantity"]')).toHaveCount(0);
    await expect(page.locator("[data-total]")).toHaveText("RM20");
    await noAxeViolations(page);
    await bar(page).click();

    await expect(page).toHaveURL(/\/contact$/);
    await page.fill("#name", "Hafiz Court");
    await page.fill("#email", to);
    await page.locator('button[value="send"]').click();
    const otp = (await inbox(page, to, /\d{6}/)).text.match(/\d{6}/)![0];
    await page.fill("#code", otp);
    await page.locator('button[value="verify"]').click();

    await expect(page).toHaveURL(/\/pay$/);
    await expect(page.locator("[data-bar] [data-total]")).toHaveText("RM20");
    await page.locator("[data-pay]").click();
    await expect(page).toHaveURL(/\/dev\/billplz\/bills\//);
    await page.locator('button[value="pay"]').click();

    await expect(page).toHaveURL(/\/bookings\/[^?]+\?k=/);
    await expect(page.locator("svg[role=img]")).toHaveCount(1);
    await expect(page.locator("[data-ticket] h3")).toHaveText("Hafiz Court");
    await expect(page.locator("[data-court]")).toHaveText(/Court [AB]$/);
    await noAxeViolations(page);
    await context.close();
  });
}
