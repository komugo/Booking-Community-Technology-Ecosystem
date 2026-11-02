import { expect, test } from "@playwright/test";
import { afterReload, API, fixture, newContext, noAxeViolations, shot, signIn, whatsappTo } from "./helpers";

const device = (request: Parameters<typeof fixture>[0], connected: boolean) => request.post(`${API}/dev/whatsapp/device`, { data: { connected } });

test.afterEach(async ({ request }) => {
  await device(request, true);
});

test("staff see failed WhatsApp sends and a disconnected device in a banner, and retry them", async ({ browser, request }) => {
  const fx = await fixture(request, { staff: true });
  const page = await (await newContext(browser)).newPage();
  await signIn(page, fx.staffEmail!, `/o/${fx.operatorId}/setup?tab=contacts`);
  await expect(page.locator("[data-whatsapp]")).toHaveCount(0);

  await device(request, false);
  const number = `01${String(Date.now()).slice(-8)}`;
  await page.getByRole("button", { name: "New contact" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name", { exact: true }).fill("Puan Rosnah");
  await sheet.getByLabel("WhatsApp number").fill(number);
  await sheet.getByRole("button", { name: "Save" }).click();
  await afterReload(page, () => expect(page.locator("[data-row]", { hasText: "Puan Rosnah" })).toContainText("Welcome failed", { timeout: 1_000 }));

  const banner = page.locator("[data-whatsapp]");
  await expect(banner).toContainText("WhatsApp is disconnected");
  const row = banner.locator("[data-failed]", { hasText: `+6${number}` });
  await expect(row).toContainText("Puan Rosnah");
  await expect(row).toContainText("Welcome");
  await expect(row.getByRole("link", { name: `+6${number}` })).toHaveAttribute("href", `tel:+6${number}`);
  await noAxeViolations(page);
  await shot(page, "whatsapp-banner");

  await row.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Sending again.")).toBeVisible();
  await afterReload(page, () => expect(row).toContainText("Puan Rosnah", { timeout: 1_000 }));

  await device(request, true);
  await row.getByRole("button", { name: "Retry" }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByText("WhatsApp is disconnected")).toHaveCount(0);
  await expect.poll(() => whatsappTo(request, `+6${number}`)).toContain("Salam Puan Rosnah");
  await page.reload();
  await expect(page.locator("[data-row]", { hasText: "Puan Rosnah" })).toContainText("Welcome sent");
});
