/**
 * Local transfer tickets (files.md §2 "Local"): same-origin URLs to the framework's transfer
 * route, each carrying an HMAC-SHA-256 signed statement of operation, name, content type
 * (uploads) and expiry. LOCAL ONLY: this module, the route and the key are never part of a cloud
 * bundle (CORE-REQ-006). Workers-compatible (Web Crypto).
 */
import { base64urlToBytes, base64urlToText, bytesToBase64url, textToBase64url } from "../base64url.js";
import type { TicketIssuer } from "../service.js";
import { TICKET_LIFETIME_MS, type DownloadTicketData, type UploadTicketData } from "../tickets.js";

/** Path of the local transfer route; the signed token is the last segment. */
export const LOCAL_TRANSFER_PATH = "/api/__framework/files/";

export type LocalTicketGrant = { readonly op: "upload"; readonly name: string; readonly contentType: string } | { readonly op: "download"; readonly name: string };

interface Payload {
  readonly o: "upload" | "download";
  readonly n: string;
  readonly t?: string;
  readonly e: number;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign(payload: Payload, secret: string): Promise<string> {
  const body = textToBase64url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(body));
  return `${body}.${bytesToBase64url(new Uint8Array(signature))}`;
}

export interface LocalTicketOptions {
  /** The framework-internal local signing secret (SEC; generated into `.dev.vars` by `dev`). */
  readonly key: () => Promise<string>;
}

export function createLocalTicketIssuer(options: LocalTicketOptions): TicketIssuer {
  return {
    async upload(name, contentType) {
      const expiresAt = Date.now() + TICKET_LIFETIME_MS;
      const token = await sign({ o: "upload", n: name, t: contentType, e: expiresAt }, await options.key());
      return { url: `${LOCAL_TRANSFER_PATH}${token}`, method: "PUT", headers: { "Content-Type": contentType }, expiresAt } satisfies UploadTicketData;
    },
    async download(name) {
      const expiresAt = Date.now() + TICKET_LIFETIME_MS;
      const token = await sign({ o: "download", n: name, e: expiresAt }, await options.key());
      return { url: `${LOCAL_TRANSFER_PATH}${token}`, expiresAt } satisfies DownloadTicketData;
    },
  };
}

/** What a token grants, or undefined when it is malformed, not signed with `secret`, or expired. */
export async function verifyLocalTicket(token: string, secret: string): Promise<LocalTicketGrant | undefined> {
  const parts = token.split(".");
  if (parts.length !== 2) return undefined;
  const [body = "", signatureText = ""] = parts;
  const signature = base64urlToBytes(signatureText);
  if (body === "" || signature === undefined || signature.byteLength === 0) return undefined;
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), signature, new TextEncoder().encode(body));
  if (!valid) return undefined;
  const json = base64urlToText(body);
  if (json === undefined) return undefined;
  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(json) as Partial<Payload>;
  } catch {
    return undefined;
  }
  if (typeof payload.n !== "string" || typeof payload.e !== "number" || Date.now() >= payload.e) return undefined;
  if (payload.o === "download") return { op: "download", name: payload.n };
  if (payload.o === "upload" && typeof payload.t === "string") return { op: "upload", name: payload.n, contentType: payload.t };
  return undefined;
}
