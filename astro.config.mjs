import { defineConfig } from "astro/config";
import node from "@astrojs/node";

export default defineConfig({
  output: "server",
  // Astro's built-in checkOrigin compares Origin against the origin it reconstructs
  // behind the reverse proxy (http/internal host), so it 403s every legitimate POST
  // in production. src/middleware.ts enforces a proxy-aware origin check instead.
  security: { checkOrigin: false },
  adapter: node({ mode: "standalone" }),
  server: { host: "0.0.0.0", port: 4321 },
  vite: {
    ssr: { external: ["better-sqlite3"] },
  },
});
