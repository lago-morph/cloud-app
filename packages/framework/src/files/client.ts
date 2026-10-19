/**
 * FILES browser helpers (contract: docs/contracts/ts/client.d.ts: transfers).
 * Stub written by B-01; implemented by B-11.
 */
import type { DownloadTicket, UploadTicket } from "./public.js";

export interface TransferProgress {
  readonly loaded: number;
  readonly total: number;
}

/** Uploads a file using a ticket obtained from the app's API. */
export function uploadFile(
  ticket: UploadTicket,
  file: Blob,
  options?: { readonly onProgress?: (p: TransferProgress) => void },
): Promise<void> {
  throw new Error("not implemented: uploadFile");
}

/** A URL usable in `<img src>` or links, valid for the ticket's lifetime. */
export function downloadUrl(ticket: DownloadTicket): string {
  throw new Error("not implemented: downloadUrl");
}
