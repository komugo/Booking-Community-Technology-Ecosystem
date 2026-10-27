import { app } from "./app";
import { cron } from "./cron";

export { OperatorBooking } from "@komugo/booking";

export default {
  fetch: app.fetch,
  scheduled: (_, env, ctx) => ctx.waitUntil(cron(env, (p) => ctx.waitUntil(p))),
} satisfies ExportedHandler<Env>;
