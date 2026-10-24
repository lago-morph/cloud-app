/**
 * Re-export of the target-neutral stage runtime, which now lives in `targets/stage.ts` so the
 * AWS Lambda bundle holds no module under a `cloudflare/` directory (CORE-REQ-006;
 * DEC-PENDING-g-06-2). Kept so existing importers keep working; new code imports `../stage.js`.
 */
export { assembleStage } from "../stage.js";
export type { StageOptions } from "../stage.js";
