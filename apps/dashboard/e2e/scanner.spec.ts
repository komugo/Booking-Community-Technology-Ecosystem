import { chromium, expect, test } from "@playwright/test";
import { CHECK_IN } from "../src/flags";
import { day, fixture, newContext, noAxeViolations, shot, signIn, writeY4m } from "./helpers";

test("Check-in is off: no Scan tab, no scanner route and no Check in button on Today", async ({ browser, request }) => {
  test.skip(CHECK_IN);
  const fx = await fixture(request, { staff: true });
  for (const [email, tabs] of [
    [fx.email, ["Today", "Schedule"]],
    [fx.staffEmail!, ["Today", "Schedule", "Setup"]],
  ] as const) {
    const page = await (await newContext(browser)).newPage();
    await signIn(page, email, `/o/${fx.operatorId}/today`);
    await expect(page.locator(`[data-ticket="${fx.codes[0]}"]`)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText([...tabs]);
    await expect(page.getByRole("button", { name: "Check in" })).toHaveCount(0);
    await page.goto(`/o/${fx.operatorId}/scan`);
    await expect(page.getByRole("heading", { name: "Nothing here" })).toBeVisible();
  }
});

test.describe("Check-in", () => {
  test.skip(!CHECK_IN, "Check-in is off (#31)");

  test("Today checks in a Participant", async ({ browser, request }) => {
    const fx = await fixture(request);
    const page = await (await newContext(browser)).newPage();
    await signIn(page, fx.email);
    const child = page.locator(`[data-ticket="${fx.codes[1]}"]`);
    await child.getByRole("button", { name: "Check in" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Check in" }).click();
    await expect(child).toContainText(/Checked in \d{2}:\d{2}/);
    await page.reload();
    await expect(child).toContainText(/Checked in \d{2}:\d{2}/);
  });

  test("the camera checks in a Ticket QR, then reports it as already checked in", async ({ request }, info) => {
    const fx = await fixture(request);
    const y4m = info.outputPath("ticket.y4m");
    writeY4m(fx.ticketIds[0], y4m);
    const browser = await chromium.launch({
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`],
    });
    try {
      const page = await (await newContext(browser, { permissions: ["camera"] })).newPage();
      await signIn(page, fx.email);
      await page.getByRole("link", { name: "Scan" }).click();

      const result = page.locator("[data-result]");
      await expect(result).toHaveAttribute("data-result", "checked_in", { timeout: 15_000 });
      await expect(result).toContainText("Aisyah Rahman");
      await expect(page.locator("[data-sync]")).toHaveText("All synced");
      await page.waitForTimeout(4000);
      await expect(result).toHaveAttribute("data-result", "checked_in");
      await noAxeViolations(page);
      await shot(page, "scanner");

      await page.getByRole("link", { name: "Today" }).click();
      await expect(page.locator(`[data-ticket="${fx.codes[0]}"]`)).toContainText(/Checked in \d{2}:\d{2}/);

      await page.getByRole("link", { name: "Scan" }).click();
      await expect(result).toHaveAttribute("data-result", "already", { timeout: 15_000 });
      await expect(result).toContainText(/Already checked in at \d{2}:\d{2}/);
    } finally {
      await browser.close();
    }
  });

  test("without a camera, typed codes queue offline and sync once back online", async ({ browser, request }) => {
    const fx = await fixture(request);
    const context = await newContext(browser);
    const page = await context.newPage();
    await signIn(page, fx.email);
    await expect(page.locator("[data-ticket]")).toHaveCount(2);
    await page.getByRole("link", { name: "Scan" }).click();

    await expect(page.locator("[data-camera-off]")).toContainText("Camera not available");
    await noAxeViolations(page);
    await shot(page, "scanner-no-camera");

    const result = page.locator("[data-result]");
    const pill = page.locator("[data-sync]");
    const type = async (code: string) => {
      await page.getByRole("button", { name: "Type code" }).first().click();
      await page.getByLabel("The 8 characters under the QR code.").fill(code);
    };

    await context.setOffline(true);
    await type(fx.codes[1].toLowerCase());
    await expect(result).toHaveAttribute("data-result", "checked_in");
    await expect(result).toContainText("Adam Rahman");
    await expect(result).toContainText("Waiting to sync");
    await expect(pill).toHaveText("Offline · 1 waiting");
    await context.setOffline(false);
    await expect(pill).toHaveText("All synced");

    await context.setOffline(true);
    await type("DEADBEEF");
    await expect(result).toHaveAttribute("data-result", "saved");
    await expect(result).toContainText("Saved, will check when back online.");
    await context.setOffline(false);
    await expect(result).toHaveAttribute("data-result", "not_found");

    await page.getByRole("link", { name: "Today" }).click();
    const child = page.locator(`[data-ticket="${fx.codes[1]}"]`);
    await expect(child).toContainText(/Checked in \d{2}:\d{2}/);
    await expect(page.locator(`[data-ticket="${fx.codes[0]}"]`)).not.toContainText("Checked in");

    const res = await page.request.get(`/api/ops/operators/${fx.operatorId}/timeslots?from=${day()}&days=1`);
    const { timeslots } = (await res.json()) as { timeslots: { groups: { tickets: { code: string; checkedInAt: number | null }[] }[] }[] };
    const tickets = timeslots.flatMap((s) => s.groups.flatMap((g) => g.tickets));
    expect(tickets.filter((x) => x.checkedInAt).map((x) => x.code)).toEqual([fx.codes[1]]);
  });
});
