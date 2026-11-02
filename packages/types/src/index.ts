import { z } from "zod";

export const HealthResponse = z.object({ ok: z.boolean() });
export type HealthResponse = z.infer<typeof HealthResponse>;
export { WAIVER, waiverText } from "./waiver";
export {
  ageOn,
  CLOSED_DAY,
  HHMM,
  isClosedDay,
  klDate,
  klWeekday,
  packExpiry,
  participantKey,
  UNLIMITED_SPOTS,
  WEEKDAYS,
  type OpeningHours,
  type Weekday,
} from "./rules";
