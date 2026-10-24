/**
 * Session cookie contents (AUTH-REQ-006, auth.md §2 "Session cookie"): format version, user ID,
 * display name, issued-at and expiry (seconds), signed with the session key. Admin status is not
 * stored. A session made by the authentication mock also carries the level the test chose
 * (`lvl`, AUTH-REQ-009); such sessions are honoured only where the mock is installed.
 */
import { signToken, verifyToken } from "./signing.js";

/** PAR-250: session lifetime (7 days), in seconds. */
export const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
/** PAR-252: clock skew tolerated for an issued-at time in the future, in seconds. */
export const CLOCK_SKEW_SECONDS = 60;

const VERSION = 1;

export interface SessionData {
  readonly id: string;
  readonly displayName: string | null;
  /** Only in sessions created by the authentication mock. */
  readonly mockLevel?: "user" | "admin";
}

interface SessionPayload {
  readonly v: number;
  readonly id: string;
  readonly name: string | null;
  readonly iat: number;
  readonly exp: number;
  readonly lvl?: "user" | "admin";
}

export async function issueSession(key: string, data: SessionData, nowMs: number): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const payload: SessionPayload = {
    v: VERSION,
    id: data.id,
    name: data.displayName,
    iat,
    exp: iat + SESSION_LIFETIME_SECONDS,
    ...(data.mockLevel === undefined ? {} : { lvl: data.mockLevel }),
  };
  return signToken(key, "session", payload);
}

/** The session in a valid, current token; undefined for a tampered, expired, future-dated or malformed one. */
export async function readSession(key: string, token: string, nowMs: number): Promise<SessionData | undefined> {
  const payload = await verifyToken(key, "session", token);
  if (!isSessionPayload(payload)) return undefined;
  const now = nowMs / 1000;
  if (now >= payload.exp || payload.iat > now + CLOCK_SKEW_SECONDS) return undefined;
  return {
    id: payload.id,
    displayName: payload.name,
    ...(payload.lvl === undefined ? {} : { mockLevel: payload.lvl }),
  };
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return (
    p["v"] === VERSION &&
    typeof p["id"] === "string" &&
    p["id"] !== "" &&
    (p["name"] === null || typeof p["name"] === "string") &&
    Number.isFinite(p["iat"]) &&
    Number.isFinite(p["exp"]) &&
    (p["lvl"] === undefined || p["lvl"] === "user" || p["lvl"] === "admin")
  );
}
