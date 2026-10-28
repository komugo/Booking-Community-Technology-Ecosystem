import { expect, test } from "@playwright/test";
import { fixture, inbox, noAxeViolations, open, shot, signIn } from "./helpers";

test("inside the window a cancel refunds the Ticket and its Add-on share", async ({ browser, request }) => {
  const fx = await fixture(request, { inWindow: true });
  const { context, page } = await open(browser);
  await signIn(page, "en", fx.customerEmail, `/bookings/${fx.bookingId}?k=${fx.k}`);
  await expect(page.locator("[data-policy]")).toContainText("Free cancellation until");

  await page.locator(`[data-ticket="${fx.ticketIds[0]}"]`).getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/cancel\?/);
  await expect(page.locator("[data-outcome=cancelled]")).toContainText("RM80 ticket + RM2.50 add-on share = RM82.50 back");
  await expect(page.locator("[data-total]")).toContainText("RM82.50 refund to the account you paid with, within 7 working days.");
  await expect(page.locator("[data-confirm]")).toHaveText("Cancel 1 ticket, get RM82.50 back");
  await noAxeViolations(page);
  await shot(page, "cancel-preview");
  await page.locator("[data-confirm]").click();

  await expect(page.getByRole("status")).toHaveText("Cancelled. RM82.50 is on its way (within 7 working days).");
  await expect(page.locator(`[data-ticket="${fx.ticketIds[0]}"] [data-stamp]`)).toHaveText("Cancelled · RM82.50 refund on its way");
  await expect(page.locator("svg[role=img]")).toHaveCount(1);
  const mail = await inbox(page, fx.customerEmail, /within 7 working days/);
  expect(mail.subject).toBe("Refund on its way: RM 82.50");
  await context.close();
});

test("after the window a cancel forfeits, and a link-only visitor must sign in to change", async ({ browser, request }) => {
  const fx = await fixture(request);
  const guest = await open(browser);
  await guest.page.goto(`/bookings/${fx.bookingId}?k=${fx.k}`);
  await expect(guest.page.getByRole("link", { name: "Sign in to change" })).toBeVisible();
  await expect(guest.page.getByRole("link", { name: "Cancel", exact: true })).toHaveCount(0);
  await guest.context.close();

  const { context, page } = await open(browser);
  await signIn(page, "en", fx.customerEmail, `/bookings/${fx.bookingId}?k=${fx.k}`);
  await expect(page.locator("[data-policy]")).toContainText("Cancelling now gives no refund.");
  await expect(page.getByRole("link", { name: "Change time" })).toHaveCount(0);
  await page.locator(`[data-ticket="${fx.ticketIds[1]}"]`).getByRole("link", { name: "Cancel" }).click();
  await expect(page.locator("[data-outcome=forfeited]")).toContainText("No refund. Free cancellation ended");
  await expect(page.locator("[data-confirm]")).toHaveText("Cancel without refund");
  await page.locator("[data-confirm]").click();
  await expect(page.getByRole("status")).toHaveText("Cancelled.");
  await expect(page.locator(`[data-ticket="${fx.ticketIds[1]}"] [data-stamp]`)).toHaveText("Forfeited");
  await context.close();
});
