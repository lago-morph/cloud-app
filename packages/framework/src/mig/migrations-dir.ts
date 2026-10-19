/**
 * Where the package ships the framework tables' migration histories (`FW/migrations/`, see
 * framework.ts). Node only (`node:url`, `import.meta.url`): kept apart from framework.ts, which
 * KV and the stage runtime import into every Worker bundle (CF-REQ-003, DEC-PENDING-B-16a-4).
 */
import { fileURLToPath } from "node:url";

/** The package's framework migrations directory (same relative place from `src/mig/` and `dist/mig/`). */
export const FRAMEWORK_MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));
