/**
 * Re-export of the target-neutral download disposition, which now lives in `files/disposition.ts`
 * so the AWS Lambda bundle (branch `aws`, DEC-0508) holds no module under a `cloudflare/` directory (CORE-REQ-006;
 * DEC-0473). Kept so existing importers keep working.
 */
export { downloadDisposition } from "../disposition.js";
