/**
 * Re-export of the target-neutral download disposition, which now lives in `files/disposition.ts`
 * so the AWS Lambda bundle holds no module under a `cloudflare/` directory (CORE-REQ-006;
 * DEC-PENDING-g-06-2). Kept so existing importers keep working.
 */
export { downloadDisposition } from "../disposition.js";
