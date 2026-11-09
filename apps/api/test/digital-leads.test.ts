import { describe, expect, test, vi } from "vitest";
import { devInbox } from "../src/email";
import { devOutbox } from "../src/whatsapp";
import { client, d1, member, rid } from "./helpers";

const lead = (o: Record<string, unknown> = {}) => ({
  kind: "quote",
  packageId: "booking",
  name: "Aisyah",
  company: "Gelanggang Seri",
  email: `${rid()}@example.com`,
  whatsapp: "012-345 6789",
  budget: "RM20k",
  brief: "Six courts, members and walk-ins.",
  sourcePage: "/booking-system",
  locale: "en",
  turnstileToken: "dev",
  ...o,
});

describe("Lead", () => {
  test("a valid quote request is stored, alerted to staff and confirmed by email", async () => {
    const body = lead({ locale: "ms" });
    expect(await client().json("POST", "/digital/leads", body)).toEqual({ status: 204, body: null });
    expect(await d1("SELECT kind, package_id, whatsapp, status, locale FROM leads WHERE email = ?", body.email)).toEqual([
      { kind: "quote", package_id: "booking", whatsapp: "+60123456789", status: "new", locale: "ms" },
    ]);
    expect(devOutbox[0]).toMatchObject({ to: "+60120000000", text: expect.stringContaining(body.email) });
    const mail = devInbox.find((e) => e.to === body.email)!;
    expect(mail.subject).toBe("Kami telah menerima permintaan sebut harga anda");
  });

  test("invalid fields are 400 with the field", async () => {
    const post = (o: Record<string, unknown>) => client().json("POST", "/digital/leads", lead(o));
    expect(await post({ email: "nope" })).toEqual({ status: 400, body: { code: "invalid_field", field: "email" } });
    expect(await post({ whatsapp: "12345" })).toEqual({ status: 400, body: { code: "invalid_field", field: "whatsapp" } });
    expect(await post({ brief: "short" })).toEqual({ status: 400, body: { code: "invalid_field", field: "brief" } });
    expect(await post({ packageId: "gold" })).toEqual({ status: 400, body: { code: "invalid_field", field: "packageId" } });
    expect(await post({ kind: "proposal", procurement: "bribe" })).toEqual({ status: 400, body: { code: "invalid_field", field: "procurement" } });
  });

  test("a failed Turnstile check is 403 and stores nothing", async () => {
    const outbound = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const req = new Request(input, init);
      if (req.url.startsWith("https://challenges.cloudflare.com/")) {
        const { secret, response } = (await req.json()) as { secret: string; response: string };
        return Response.json({ success: secret === "turnstile_test" && response === "good" });
      }
      return outbound(input, init);
    });
    const bad = lead({ turnstileToken: "bad" });
    expect(await client().json("POST", "/digital/leads", bad)).toEqual({ status: 403, body: { code: "turnstile_failed" } });
    expect(await d1("SELECT id FROM leads WHERE email = ?", bad.email)).toEqual([]);
    expect(await client().json("POST", "/digital/leads", lead({ turnstileToken: "good" }))).toEqual({ status: 204, body: null });
  });

  test("the dev Turnstile token only works with DEV_SEED=1", async () => {
    const body = lead();
    expect(await client({ DEV_SEED: "0" }).json("POST", "/digital/leads", body)).toEqual({ status: 403, body: { code: "turnstile_failed" } });
    expect(await d1("SELECT id FROM leads WHERE email = ?", body.email)).toEqual([]);
  });

  test("a non-object body is 400, and newlines in one-line fields collapse", async () => {
    expect((await client().call("POST", "/digital/leads", null, { "content-type": "application/json" })).status).toBe(400);
    const body = lead({ name: "x\nBudget: RM500k" });
    await client().call("POST", "/digital/leads", body);
    expect(await d1("SELECT name FROM leads WHERE email = ?", body.email)).toEqual([{ name: "x Budget: RM500k" }]);
  });

  test("rate limited per IP", async () => {
    const cl = client();
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await cl.call("POST", "/digital/leads", {})).status);
    expect(codes).toEqual([...Array(10).fill(400), 429]);
  });

  test("staff list Leads newest first and set their status; operators can't", async () => {
    const first = lead();
    const second = lead({ kind: "proposal", packageId: "gov-portal", agency: "Jabatan Contoh", procurement: "tender" });
    await client().call("POST", "/digital/leads", first);
    await client().call("POST", "/digital/leads", second);
    await d1("UPDATE leads SET created_at = created_at - 1000 WHERE email = ?", first.email);

    const staff = await member("staff");
    const { status, body } = await staff.json<{ leads: { id: string; email: string; status: string; agency: string | null }[] }>("GET", "/ops/leads");
    expect(status).toBe(200);
    const mine = body.leads.filter((l) => [first.email, second.email].includes(l.email));
    expect(mine.map((l) => l.email)).toEqual([second.email, first.email]);
    expect(mine[0]).toMatchObject({ status: "new", agency: "Jabatan Contoh" });

    expect(await staff.json("PATCH", `/ops/leads/${mine[0].id}`, { status: "contacted" })).toEqual({ status: 204, body: null });
    expect(await d1("SELECT status FROM leads WHERE id = ?", mine[0].id)).toEqual([{ status: "contacted" }]);
    expect(await staff.json("PATCH", `/ops/leads/${mine[0].id}`, { status: "maybe" })).toEqual({ status: 400, body: { code: "invalid_field", field: "status" } });
    expect(await staff.json("PATCH", `/ops/leads/${rid()}`, { status: "won" })).toEqual({ status: 404, body: { code: "not_found" } });

    const op = await member("operator", (await d1<{ id: string }>("INSERT INTO operators (id, name) VALUES (?, 'Op') RETURNING id", rid()))[0].id);
    expect((await op.call("GET", "/ops/leads")).status).toBe(403);
    expect((await op.call("PATCH", `/ops/leads/${mine[0].id}`, { status: "won" })).status).toBe(403);
  });
});
