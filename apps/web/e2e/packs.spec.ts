import { expect, test, type Page } from "@playwright/test";
import { bar, fixture, noAxeViolations, open, prefix, shot, signInHere, type Fixture, type Locale } from "./helpers";

async function buyPack(page: Page, l: Locale, fx: Fixture) {
  await page.goto(`${prefix(l)}${fx.activityPath}`);
  const card = page.locator(`#pack-${fx.offerId}`);
  await expect(card).toBeVisible();
  await card.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/packs/buy/${fx.offerId}$`));
  await bar(page).click();
  await signInHere(page, fx.customerEmail);
  await expect(page).toHaveURL(new RegExp(`/packs/buy/${fx.offerId}$`));
  await page.locator("[data-pay]").click();
  await expect(page).toHaveURL(/\/dev\/billplz\/bills\//);
  await page.locator('button[value="pay"]').click();
  await expect(page).toHaveURL(/\/packs\/[^/?]+\?k=[^&]+&new=1$/);
}

// Book an eligible Option for the fixture's two saved people, up to the Pay step.
async function bookForTwo(page: Page) {
  await page.locator("section[aria-labelledby=book] a").first().click();
  await expect(page).toHaveURL(/\/book\//);
  await page.locator("label:has(input[name=timeslotId])").first().click();
  await page.locator('[data-for="quantity"][data-by="1"]').click();
  await bar(page).click();
  await expect(page).toHaveURL(/\/who$/);
  for (const [i, name] of ["Aisyah Rahman", "Adam Rahman"].entries()) {
    await page.locator("[data-person]").nth(i).locator("[data-fill]", { hasText: name }).click();
  }
  await bar(page).click();
  await expect(page).toHaveURL(/\/pay$/);
}

test("a Customer buys a Pack, then books 2 people with it", async ({ browser, request }) => {
  const fx = await fixture(request, { packOffer: true, extraSlots: 2 });
  const { context, page } = await open(browser);

  await page.goto(fx.activityPath);
  await page.locator("#packs").scrollIntoViewIfNeeded();
  await expect(page.locator(`#pack-${fx.offerId}`)).toContainText("4 sessions · RM250");
  await expect(page.locator(`#pack-${fx.offerId}`)).toContainText("RM62.50 per session");
  await shot(page, "pack-offer");
  await page.goto(`/packs/buy/${fx.offerId}`);
  await noAxeViolations(page);
  await shot(page, "pack-buy");

  await buyPack(page, "en", fx);
  await expect(page.locator("main h1")).toHaveText("Your Pack is ready!");
  await expect(page.locator("[data-left]")).toHaveText("4 of 4 left");
  await noAxeViolations(page);
  await shot(page, "pack-ready");

  await bookForTwo(page);
  const use = page.locator("[data-use-pack]");
  await expect(use).toContainText("Uses 2 sessions · 2 left after");
  await expect(page.locator("[data-pay]")).toHaveText("Or pay RM160");
  await noAxeViolations(page);
  await shot(page, "pay-use-pack");
  await use.getByRole("button", { name: "Use Pack, pay RM0" }).click();

  await expect(page).toHaveURL(/\/packs\/[^/?]+\?k=[^&]+&booked=/);
  await expect(page.locator("main h1")).toHaveText("You're booked!");
  await expect(page.locator("[data-left]")).toHaveText("2 of 4 left");
  await expect(page.locator("svg[role=img]")).toHaveCount(2);
  await shot(page, "pack-booked");
  const packUrl = page.url();

  await page.locator("[data-my-bookings]").click();
  await expect(page).toHaveURL(/\/bookings$/);
  await expect(page.locator("[data-pack]")).toContainText("2 of 4 left");
  await expect(page.locator("[data-upcoming]").filter({ hasText: "Pack" })).toContainText(/Aisyah Rahman, Adam Rahman|Adam Rahman, Aisyah Rahman/);
  await noAxeViolations(page);
  await shot(page, "my-bookings");

  await page.goto(packUrl);
  const ticket = page.locator("[data-ticket]").first();
  const ticketId = await ticket.getAttribute("data-ticket");
  await ticket.getByRole("link", { name: "Cancel" }).click();
  await expect(page.locator("[data-outcome=cancelled]")).toHaveText(/The session goes back to your Pack\./);
  await expect(page.locator("[data-confirm]")).toHaveText("Cancel and return session");
  await page.locator("[data-confirm]").click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.locator(`[data-ticket="${ticketId}"] [data-stamp]`)).toHaveText("Session returned to your Pack");
  await expect(page.locator("[data-left]")).toHaveText("3 of 4 left");
  await context.close();
});

test("a Pack with too few sessions explains why it can't pay (ms)", async ({ browser, request }) => {
  const fx = await fixture(request, { locale: "ms", packOffer: true, packSessions: 1, extraSlots: 1 });
  const { context, page } = await open(browser);
  await buyPack(page, "ms", fx);
  await expect(page.locator("main h1")).toHaveText("Pek anda sudah sedia!");
  await bookForTwo(page);
  await expect(page.locator('[data-why="used_up"]')).toHaveText("Anda perlukan 2 sesi; Pek anda tinggal 1.");
  await expect(page.locator("[data-pay]")).toHaveText("Bayar RM160");
  await context.close();
});

test("a Pack can't pay for a time after its use-by date", async ({ browser, request }) => {
  const fx = await fixture(request, { packOffer: true, packValidDays: 1, extraSlots: 3 });
  const { context, page } = await open(browser);
  await buyPack(page, "en", fx);
  await page.locator("section[aria-labelledby=book] a").first().click();
  await expect(page).toHaveURL(/\/book\//);
  const late = new Date(Date.now() + 3 * 86_400_000 + 3_600_000 + 8 * 3_600_000).toISOString().slice(0, 10);
  await page.goto(`${page.url().split("?")[0]}?date=${late}`);
  await page.locator("label:has(input[name=timeslotId])").first().click();
  await bar(page).click();
  await expect(page).toHaveURL(/\/who$/);
  await page.locator("[data-person]").first().locator("[data-fill]", { hasText: "Aisyah Rahman" }).click();
  await bar(page).click();
  await expect(page).toHaveURL(/\/pay$/);
  await expect(page.locator('[data-why="after_expiry"]')).toContainText("Your Pack covers sessions until");
  await expect(page.getByRole("button", { name: "Use Pack, pay RM0" })).toHaveCount(0);
  await context.close();
});
