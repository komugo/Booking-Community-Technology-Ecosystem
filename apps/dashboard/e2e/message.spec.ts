import { expect, test } from "@playwright/test";
import { fixture, newContext, noAxeViolations, shot, signIn, whatsappOutbox } from "./helpers";

test("after a staff Closure, staff edit the pre-filled draft and send it to the Operator's contacts", async ({ browser, request }) => {
  const fx = await fixture(request, { staff: true });
  const page = await (await newContext(browser)).newPage();
  await signIn(page, fx.staffEmail!, `/o/${fx.operatorId}/timeslots/${fx.timeslotId}`);
  await page.getByRole("button", { name: "Close Timeslot" }).click();
  const close = page.getByRole("dialog", { name: "Close Timeslot" });
  await close.getByText("Weather").click();
  await close.getByRole("button", { name: "Close and email customers" }).click();
  await expect(page.getByText(/Closed \(Weather\) at \d{2}:\d{2}/)).toBeVisible();

  await page.getByRole("button", { name: "Message contacts" }).click();
  const sheet = page.getByRole("dialog", { name: "Message contacts" });
  await expect(sheet.getByRole("checkbox", { name: /Siti/ })).toBeChecked();
  const text = sheet.getByLabel("Message");
  await expect(text).toHaveValue(/^Closed .+, \w{3}, \d+ \w{3} \d{2}:\d{2}.*, 1 Customer asked to choose a Refund or Reschedule$/);
  await noAxeViolations(page);
  await shot(page, "message");

  const note = `Ref ${fx.operatorId}`;
  await text.fill(`${await text.inputValue()}. ${note}`);
  await sheet.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sending to 1 contact.")).toBeVisible();
  await expect(sheet).toBeHidden();
  await expect.poll(async () => (await whatsappOutbox(request)).find((m) => m.text.endsWith(note))?.to).toBe("+60181234567");

  await page.goto(`/o/${fx.operatorId}/setup?tab=contacts`);
  await page.getByRole("button", { name: "Message contacts" }).click();
  await sheet.getByRole("checkbox", { name: /Siti/ }).uncheck();
  await sheet.getByLabel("Message").fill("Hello");
  await expect(sheet.getByRole("button", { name: "Send" })).toBeDisabled();
});
