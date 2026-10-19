import { defineConfig } from "vite";

// HTTP §2: Vite serves the client and proxies /api to `wrangler dev` on one origin.
export default defineConfig({
  root: "client",
  build: { outDir: "../dist/client", emptyOutDir: true },
  server: { port: 5199, strictPort: true, host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:8799" } },
});
