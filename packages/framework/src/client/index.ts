/**
 * Hub for `./client` (CORE-REQ-005): browser helpers, exactly the names of
 * docs/contracts/ts/client.d.ts. Re-exports only; owners HTTP, AUTH, FILES (each `client.ts`).
 */
export type { ErrorCode } from "../core/errors.js";
export type { CurrentUser } from "../auth/public.js";
export type { UploadTicket, DownloadTicket } from "../files/public.js";

export { ApiError, api } from "../http/client.js";
export type { ApiRequestOptions } from "../http/client.js";
export { getCurrentUser, login, logout } from "../auth/client.js";
export { uploadFile, downloadUrl } from "../files/client.js";
export type { TransferProgress } from "../files/client.js";
