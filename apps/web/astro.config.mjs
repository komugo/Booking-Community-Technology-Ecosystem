import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? "http://localhost:4321",
  output: "server",
  trailingSlash: "never",
  session: false,
  security: { checkOrigin: false },
  adapter: cloudflare({ imageService: "passthrough", persistState: { path: "../../.wrangler/state" } }),
  i18n: {
    defaultLocale: "en",
    locales: ["en", "ms"],
    routing: { prefixDefaultLocale: false },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
