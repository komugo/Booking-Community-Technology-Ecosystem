import { env } from "cloudflare:workers";
import { createDb } from "@komugo/db";

export const db = createDb(env.DB);
export const showDrafts = import.meta.env.DEV || env.SHOW_DRAFTS === "true";
