import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import runtimeEnv from "vite-plugin-runtime-env";
import path from "path";

export default defineConfig({
  envDir: path.resolve(__dirname, "../.."),
  plugins: [
    TanStackRouterVite(),
    react(),
    tailwindcss(),
    runtimeEnv({ variableName: "window.__ENV__", injectHtml: false }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": process.env.API_PROXY_TARGET ?? "http://localhost:3000",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    server: {
      deps: {
        // @stellar/freighter-api ships a CJS-only UMD bundle.
        // @creit.tech/stellar-wallets-kit's freighter module imports named
        // exports from it which Node.js ESM cannot resolve from CJS.
        // Inlining them through Vite's transform pipeline converts the CJS
        // bundle to ESM with named-export compatibility.
        inline: ["@stellar/freighter-api", "@creit.tech/stellar-wallets-kit"],
      },
    },
  },
});
