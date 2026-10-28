import { expect, test } from "@playwright/test";
import { fixture, newContext, noAxeViolations, signIn } from "./helpers";

test("operator signs in, keeps BM across reloads and can't open another Operator", async ({ browser, request }) => {
  const fx = await fixture(request);
  const other = await fixture(request);
  const page = await (await newContext(browser)).newPage();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in to Komugo for Operators" })).toBeVisible();
  await noAxeViolations(page);
  await signIn(page, fx.email);
  await expect(page).toHaveURL(`/o/${fx.operatorId}/today`);
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(page.locator("[data-timeslot]")).toHaveCount(1);
  await noAxeViolations(page);

  await page.getByRole("button", { name: "BM" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Hari ini" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Hari ini" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ms-MY");

  await page.goto(`/o/${other.operatorId}/today`);
  await expect(page.getByRole("heading", { name: "Tiada apa-apa di sini" })).toBeVisible();
});

test("staff picks any Operator", async ({ browser, request }) => {
  const fx = await fixture(request, { staff: true });
  const other = await fixture(request);
  const page = await (await newContext(browser)).newPage();

  await signIn(page, fx.staffEmail!);
  await expect(page.getByRole("heading", { name: "Choose an Operator" })).toBeVisible();
  await page.getByRole("link", { name: `Fixture Stable ${fx.operatorId.slice(3)}` }).click();
  await expect(page).toHaveURL(`/o/${fx.operatorId}/today`);
  await expect(page.locator("[data-timeslot]")).toHaveCount(1);

  await page.getByRole("link", { name: "Switch Operator" }).click();
  await page.getByRole("link", { name: `Fixture Stable ${other.operatorId.slice(3)}` }).click();
  await expect(page).toHaveURL(`/o/${other.operatorId}/today`);
  await expect(page.locator("[data-timeslot]")).toHaveCount(1);

  const cached = () => page.evaluate(() => Object.keys(localStorage).filter((k) => /^ops:(day|scans):/.test(k)));
  expect(await cached()).not.toEqual([]);
  await page.getByRole("link", { name: "Switch Operator" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  expect(await cached()).toEqual([]);
});
