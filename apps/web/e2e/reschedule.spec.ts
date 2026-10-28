import { expect, test } from "@playwright/test";
import { bar, fixture, noAxeViolations, open, shot, signIn } from "./helpers";

test("inside the window a Ticket moves to another time and keeps its QR code", async ({ browser, request }) => {
  const fx = await fixture(request, { inWindow: true, extraSlots: 2 });
  const { context, page } = await open(browser);
  await signIn(page, "en", fx.customerEmail, `/bookings/${fx.bookingId}?k=${fx.k}`);
  const ticket = page.locator(`[data-ticket="${fx.ticketIds[0]}"]`);
  const code = await ticket.locator("[data-code]").textContent();

  await ticket.getByRole("link", { name: "Change time" }).click();
  await expect(page.locator("main h1")).toHaveText("Move Aisyah Rahman's session");
  await page.locator("label:has(input[name=timeslotId])").first().click();
  await expect(bar(page)).toHaveText(/^Move to /);
  await noAxeViolations(page);
  await shot(page, "reschedule");
  await bar(page).click();

  await expect(page.getByRole("status")).toHaveText(/^Moved to /);
  await expect(page.locator("[data-visit]")).toHaveCount(2);
  const moved = page.locator(`[data-visit="${fx.extraSlotIds[0]}"] [data-ticket="${fx.ticketIds[0]}"]`);
  await expect(moved.locator("[data-code]")).toHaveText(code!);
  await expect(moved.locator("svg[role=img]")).toHaveCount(1);
  await context.close();
});
