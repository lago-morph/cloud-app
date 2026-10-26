/**
 * Re-export of the target-neutral stage runtime, which now lives in `targets/stage.ts` so the
 * AWS Lambda bundle (branch `aws`, DEC-0508) holds no module under a `cloudflare/` directory (CORE-REQ-006;
 * DEC-0473). Kept so existing importers keep working; new code imports `../stage.js`.
 */
export { assembleStage } from "../stage.js";
export type { StageOptions } from "../stage.js";
