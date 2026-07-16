import { defineConfig } from "vite";

// In production nginx routes these paths to the API server; in dev the
// Vite server proxies them to a locally running `npm run server`.
const API_TARGET = "http://127.0.0.1:3001";

export default defineConfig({
    server: {
        proxy: {
            "/api": API_TARGET,
            "/uploads": API_TARGET,
        },
    },
});
