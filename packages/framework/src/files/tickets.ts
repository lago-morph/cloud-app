/**
 * What a ticket holds (files.md §2 "Tickets"), shared by every target's issuer and the browser
 * helpers. App code sees only the opaque `UploadTicket` / `DownloadTicket` types.
 * Browser- and Workers-compatible.
 */

/** PAR-233: ticket lifetime. */
export const TICKET_LIFETIME_MS = 15 * 60 * 1000;

export interface UploadTicketData {
  readonly url: string;
  readonly method: "PUT";
  /** Headers the request must send; always `Content-Type`. */
  readonly headers: Readonly<Record<string, string>>;
  /** Milliseconds since the epoch. */
  readonly expiresAt: number;
}

export interface DownloadTicketData {
  readonly url: string;
  readonly expiresAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The ticket's data, or undefined when `ticket` is not an upload ticket. */
export function readUploadTicket(ticket: unknown): UploadTicketData | undefined {
  if (!isRecord(ticket) || typeof ticket["url"] !== "string" || ticket["method"] !== "PUT" || typeof ticket["expiresAt"] !== "number") return undefined;
  const headers = ticket["headers"];
  if (!isRecord(headers) || typeof headers["Content-Type"] !== "string") return undefined;
  if (!Object.values(headers).every((v) => typeof v === "string")) return undefined;
  return ticket as unknown as UploadTicketData;
}

/** The ticket's data, or undefined when `ticket` is not a download ticket. */
export function readDownloadTicket(ticket: unknown): DownloadTicketData | undefined {
  if (!isRecord(ticket) || typeof ticket["url"] !== "string" || typeof ticket["expiresAt"] !== "number" || "method" in ticket) return undefined;
  return ticket as unknown as DownloadTicketData;
}
