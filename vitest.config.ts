import { defineConfig } from "vitest/config";
import { UNIT_RUNNER } from "./vitest.unit.config.js";

// Loaded only by a bare `npx vitest run [paths]` (no --config). Without it such a run uses Vitest's 5 s test and
// 10 s hook defaults, which PGlite-backed suites exceed under parallel load (see
// ai/implementation/root-causes/2026-10-24-data-api-fake-template-intermittent.md). It sets the unit layer's
// runner limits and leaves `include` at Vitest's default, so a bare run selects the same files as before.
// `npm run test:unit` and `npm run test:integration` pass their own --config and do not read this file.
export default defineConfig({ test: { ...UNIT_RUNNER } });
