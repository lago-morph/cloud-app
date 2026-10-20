import type { CaseSets } from "./case-types";

/**
 * The case sets `POST /api/cases/run` executes. C-T2 writes them in `src/server/cases/**` and
 * replaces this module's body with `export { caseSets } from "./cases/index";` (ROUTES.md
 * "Shared case sets"); until then no set is registered.
 */
export const caseSets: CaseSets = {};
