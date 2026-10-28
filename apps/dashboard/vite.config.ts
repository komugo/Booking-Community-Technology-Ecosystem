import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.PORT ?? 5180),
    strictPort: true,
    proxy: { "/api": { target: process.env.API_URL ?? "http://localhost:8790", rewrite: (p) => p.slice(4) } },
  },
});
