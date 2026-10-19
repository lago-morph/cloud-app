import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://127.0.0.1:5199" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    { command: "npx wrangler dev --port 8799 --ip 127.0.0.1", url: "http://127.0.0.1:8799/api/health", reuseExistingServer: false, timeout: 60_000 },
    { command: "npx vite", url: "http://127.0.0.1:5199/", reuseExistingServer: false, timeout: 60_000 },
  ],
});
