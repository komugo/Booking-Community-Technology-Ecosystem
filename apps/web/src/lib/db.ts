import { env } from "cloudflare:workers";
import { createDb } from "@komugo/db";

export const db = createDb(env.DB);
export const showDrafts = import.meta.env.DEV || env.SHOW_DRAFTS === "true";

// Matches the API: no sale until staff agree the Operator's Commission.
export const sells = (listingMode: string, commissionBps: number | null) =>
  showDrafts ? listingMode !== "info" : listingMode === "bookable" && commissionBps !== null;
