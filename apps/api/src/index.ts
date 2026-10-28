import { app } from "./app";
import { cron } from "./cron";

export { OperatorBooking } from "@komugo/booking";

export default {
  fetch: app.fetch,
  scheduled: (ctl, env, ctx) => ctx.waitUntil(cron(env, (p) => ctx.waitUntil(p), Date.now(), ctl.cron)),
} satisfies ExportedHandler<Env>;
