import { defineConfig } from "@playwright/test";

// The app's e2e layer (the skill's reference/testing/e2e.md): two projects against a local `dev`
// server that Playwright starts and stops.
// - "e2e-api": most e2e tests, through the HTTP API with the `request` fixture; no browser.
//   `npm run verify` runs it after the unit tests.
// - "e2e-ui": the few tests of what only a browser shows; the only project that needs Chromium.
// `dev` binds a free port and prints "… is running at http://localhost:<port>/". `webServer.wait`
// reads the port into APP_E2E_PORT for the test workers, which load this file again.
const port = process.env["APP_E2E_PORT"];
const origin = port === undefined ? "http://localhost" : `http://localhost:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  // One local server and one local database: tests use fresh mock users, not a fresh database.
  workers: 1,
  projects: [
    // State-changing API requests must carry the app's origin (the framework's forgery check).
    { name: "e2e-api", testMatch: "api/**/*.spec.ts", use: { baseURL: origin, extraHTTPHeaders: { Origin: origin } } },
    { name: "e2e-ui", testMatch: "ui/**/*.spec.ts", use: { baseURL: origin, browserName: "chromium" } },
  ],
  webServer: {
    command: "npm run dev",
    wait: { stdout: /is running at http:\/\/localhost:(?<app_e2e_port>\d+)\// },
    // dev's own server log is not test output; its "is running at" line is still read for the port.
    stderr: "ignore",
    timeout: 120_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
