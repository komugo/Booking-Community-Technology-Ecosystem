import { app } from "./app";
import { cron } from "./cron";
import { deliver, type Job } from "./whatsapp";

export { OperatorBooking } from "@komugo/booking";

export default {
  fetch: app.fetch,
  queue: deliver,
  scheduled: (ctl, env, ctx) => ctx.waitUntil(cron(env, (p) => ctx.waitUntil(p), Date.now(), ctl.cron)),
} satisfies ExportedHandler<Env, Job>;
