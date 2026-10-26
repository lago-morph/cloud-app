import { defineConfig } from "vitest/config";
import { UNIT_RUNNER } from "../../../../vitest.unit.config.js";

// The live wizard pass's guard tests, against a fake fetch (no network):
// `npx vitest run --config ai/implementation/spikes/live-wizard/vitest.config.ts`.
export default defineConfig({
  test: { root: import.meta.dirname, include: ["*.unit.test.ts"], ...UNIT_RUNNER },
});
