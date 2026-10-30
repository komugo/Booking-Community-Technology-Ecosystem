import { expect, test } from "@playwright/test";
import { bar, email, fixture, inbox, noAxeViolations, open, prefix } from "./helpers";

for (const locale of ["en", "ms"] as const) {
  test(`a guest buys 2 Date tickets for a day and gets QR Tickets showing the opening hours (${locale})`, async ({ browser, request }) => {
    const f = await fixture(request, { dateTicket: true, dailyLimit: 3 });
    const { context, page } = await open(browser);
    const to = email(`date-${locale}`);

    await page.goto(`${prefix(locale)}/book/${f.dateOptionId}`);
    await expect(page.locator("h1")).toHaveText(locale === "ms" ? "Pilih tarikh" : "Choose a date");
    await page.locator("a[data-day]").nth(2).click();
    await expect(page.locator("label:has(input[name=timeslotId])")).toHaveCount(1);
    await expect(page.locator("label:has(input[name=timeslotId]:checked)")).toContainText(/6:00.*–.*11:30/);
    await expect(page.locator("label:has(input[name=timeslotId])")).toContainText(locale === "ms" ? "Tinggal 3" : "3 left");
    await page.locator('[data-for="quantity"][data-by="1"]').click();
    await expect(page.locator("[data-total]")).toHaveText("RM30");
    await noAxeViolations(page);
    await bar(page).click();

    await expect(page).toHaveURL(/\/who$/);
    for (const [i, name] of ["Aina Rahman", "Adam Rahman"].entries()) {
      const card = page.locator("[data-person]").nth(i);
      await card.locator('[data-f="name"]').fill(name);
      await card.locator('[data-f="dd"]').fill("01");
      await card.locator('[data-f="mm"]').fill("02");
      await card.locator('[data-f="yyyy"]').fill(String(1990 + i));
    }
    await bar(page).click();

    await expect(page).toHaveURL(/\/contact$/);
    await page.fill("#name", "Aina Rahman");
    await page.fill("#email", to);
    await page.locator('button[value="send"]').click();
    const otp = (await inbox(page, to, /\d{6}/)).text.match(/\d{6}/)![0];
    await page.fill("#code", otp);
    await page.locator('button[value="verify"]').click();

    await expect(page).toHaveURL(/\/pay$/);
    await expect(page.locator("section[aria-labelledby=summary]")).toContainText(/6:00.*–.*11:30/);
    await page.locator("[data-pay]").click();
    await expect(page).toHaveURL(/\/dev\/billplz\/bills\//);
    await page.locator('button[value="pay"]').click();

    await expect(page).toHaveURL(/\/bookings\/[^?]+\?k=/);
    await expect(page.locator("svg[role=img]")).toHaveCount(2);
    await expect(page.locator("[data-ticket]").first()).toContainText(/6:00.*–.*11:30/);
    await noAxeViolations(page);
    await context.close();
  });
}
