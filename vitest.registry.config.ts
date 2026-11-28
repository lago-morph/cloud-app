import { defineConfig } from "vitest/config";

// Registry layer: the few tests that install from the live npm registry with no lockfile, to catch a
// registry change that breaks a new app's install (DEC-0802). Needs the network, so it is in neither
// the unit nor the integration layer (offline runs); .github/workflows/release.yml runs it before publishing.
export default defineConfig({
  test: {
    include: ["packages/create-prototype-app/test/**/*.registry.test.ts"],
    pool: "forks",
    testTimeout: 60_000,
  },
});
