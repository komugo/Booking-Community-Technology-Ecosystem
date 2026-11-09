import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? "https://digital.komugo.com",
  output: "static",
  trailingSlash: "never",
  session: false,
  build: { format: "file" },
  server: { port: 4322 },
  adapter: cloudflare({ imageService: "passthrough" }),
  i18n: {
    defaultLocale: "en",
    locales: ["en", "ms"],
    routing: { prefixDefaultLocale: false },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
