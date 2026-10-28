import { expect, test } from "@playwright/test";
import { customerCancel, emails, fixture, newContext, noAxeViolations, shot, signIn } from "./helpers";

test("staff pay a cancel Refund; operators can't see Refunds", async ({ browser, request }) => {
  const fx = await fixture(request, { staff: true, inWindow: true });
  const cancelled = await customerCancel(request, fx, fx.ticketIds.join(","));
  expect(cancelled.refund.amountSen).toBe(16500);

  const page = await (await newContext(browser)).newPage();
  await signIn(page, fx.staffEmail!, "/refunds");
  await expect(page).toHaveURL("/refunds");
  const card = page.locator(`[data-refund="${cancelled.refund.id}"]`);
  await expect(card).toContainText("RM165.00");
  await expect(card).toContainText("Aisyah Rahman");
  await expect(card).toContainText("+60123456789");
  await expect(card).toContainText("Cancelled");
  await noAxeViolations(page);
  await shot(page, "dash-refunds");

  await card.getByRole("button", { name: "Mark refunded" }).click();
  const sheet = page.getByRole("dialog", { name: "Mark refunded" });
  await expect(sheet.locator("[data-confirm-text]")).toContainText("Confirm you've paid RM165.00 to Aisyah Rahman");
  await sheet.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Marked refunded. Customer emailed." })).toBeVisible();
  await expect(page.locator("#refunded").locator("..").locator(`[data-refund="${cancelled.refund.id}"]`)).toContainText("Refunded");
  await expect
    .poll(async () => (await emails(request)).filter((e) => e.to === fx.customerEmail && e.subject.startsWith("Refund sent")).length)
    .toBe(1);

  const op = await (await newContext(browser)).newPage();
  await signIn(op, fx.email);
  await expect(op.getByRole("link", { name: "Refunds" })).toHaveCount(0);
  await op.goto("/refunds");
  await expect(op.getByRole("heading", { name: "Nothing here" })).toBeVisible();
});
