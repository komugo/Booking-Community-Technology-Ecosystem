import { z } from "zod";

export const HealthResponse = z.object({ ok: z.boolean() });
export type HealthResponse = z.infer<typeof HealthResponse>;
