import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const demosaasDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  /** Carga `.env` de la raíz del repo (Hackaton/.env) para `demo_saas_VITE_*` sin duplicar archivo. */
  envDir: path.resolve(demosaasDir, ".."),
  envPrefix: ["VITE_", "demo_saas_VITE_"],
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ["hack.dark-army.lat", "demosaas.dark-army.lat"],
    proxy: {
      "/api/v1": {
        target: "https://backend.dark-army.lat",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
