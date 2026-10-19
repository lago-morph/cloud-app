/**
 * FILES browser helpers (contract: docs/contracts/ts/client.d.ts: transfers; FILES-REQ-003,
 * FILES-REQ-006). Target-neutral: a ticket holds the URL (and, for uploads, the method and
 * headers) of one direct request to storage, whatever the target. Browser code: Web APIs only.
 */
import { ApiError } from "../http/client.js";
import type { DownloadTicket, UploadTicket } from "./public.js";
import { readDownloadTicket, readUploadTicket } from "./tickets.js";

export interface TransferProgress {
  readonly loaded: number;
  readonly total: number;
}

/** FILES-REQ-006: status is storage's when one was received, else null; never storage's body. */
function transferFailed(message: string, status: number | null = null): ApiError {
  return new ApiError(message, { code: "FILES.TRANSFER_FAILED", status });
}

/**
 * Uploads a file using a ticket obtained from the app's API, as one `PUT` (DEC-0062). No size
 * limit is imposed by the framework. Always sends the ticket's content type; a Blob whose
 * non-empty `type` differs is rejected before sending.
 */
export async function uploadFile(
  ticket: UploadTicket,
  file: Blob,
  options?: { readonly onProgress?: (p: TransferProgress) => void },
): Promise<void> {
  const data = readUploadTicket(ticket);
  if (data === undefined) throw transferFailed("rejected before sending: not an upload ticket");
  const contentType = data.headers["Content-Type"] ?? "";
  if (file.type !== "" && file.type.toLowerCase() !== contentType.toLowerCase()) {
    throw transferFailed("content type does not match ticket");
  }
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let sent = 0;
    xhr.open(data.method, data.url);
    for (const [name, value] of Object.entries(data.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      sent = event.loaded;
      options?.onProgress?.({ loaded: event.loaded, total: file.size });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(transferFailed(`rejected by storage (HTTP ${xhr.status})`, xhr.status));
    };
    xhr.onerror = xhr.onabort = xhr.ontimeout = () => {
      reject(transferFailed(sent > 0 ? `interrupted after ${sent} bytes` : "no response: network or cross-origin blocked"));
    };
    xhr.send(file);
  });
}

/** A URL usable in `<img src>` or links, valid for the ticket's lifetime. */
export function downloadUrl(ticket: DownloadTicket): string {
  const data = readDownloadTicket(ticket);
  if (data === undefined) throw transferFailed("rejected before sending: not a download ticket");
  return data.url;
}
