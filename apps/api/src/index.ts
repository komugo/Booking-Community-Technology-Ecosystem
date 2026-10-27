import { app } from "./app";

export { OperatorBooking } from "@komugo/booking";

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
