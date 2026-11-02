import { expect, test } from "@playwright/test";
import { bar, email, fixture, inbox, noAxeViolations, open, prefix } from "./helpers";

for (const locale of ["en", "ms"] as const) {
  test(`a guest books a court for 2 back-to-back hours with no Who step and gets one Ticket showing the court (${locale})`, async ({ browser, request }) => {
    const f = await fixture(request, { court: true });
    const { context, page } = await open(browser);
    const to = email(`court-${locale}`);

    await page.goto(`${prefix(locale)}/book/${f.courtOptionId}`);
    await expect(page.locator("#people-label")).toHaveText(locale === "ms" ? "Bilangan jam" : "Hours");
    await expect(page.locator("#quantity")).toHaveAttribute("max", "2");
    await expect(page.locator("[data-total]")).toHaveText("RM20");
    await page.locator('[data-for="quantity"][data-by="1"]').click();
    await expect(page.locator('[data-for="quantity"][data-by="1"]')).toBeDisabled();
    await expect(page.locator("[data-total]")).toHaveText("RM40");
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
    await expect(page.locator("[data-bar] [data-total]")).toHaveText("RM40");
    await page.locator("[data-pay]").click();
    await expect(page).toHaveURL(/\/dev\/billplz\/bills\//);
    await page.locator('button[value="pay"]').click();

    await expect(page).toHaveURL(/\/bookings\/[^?]+\?k=/);
    await expect(page.locator("svg[role=img]")).toHaveCount(1);
    await expect(page.locator("[data-ticket] h3")).toHaveText("Hafiz Court");
    await expect(page.locator("[data-court]")).toHaveText(/Court [AB]$/);
    await expect(page.locator("[data-ticket]")).toContainText("–");
    await noAxeViolations(page);
    await context.close();
  });
}
