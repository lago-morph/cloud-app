/**
 * Session cookie contents (AUTH-REQ-006, auth.md §2 "Session cookie"): format version, user ID,
 * display name, issued-at and expiry (seconds), signed with the session key. Admin status is not
 * stored: it is read from the account per request (AUTH-REQ-003, DEC-0524).
 *
 * Format version 3 (DEC-0524, DEC-0672). A session is exactly one of:
 * - a real-provider session, carrying the provider id (`prv`) and the provider's subject (`sub`),
 *   so that AUTH can ask that provider for `accountStatus(subject)`;
 * - a session made by the authentication mock, carrying the level the test chose (`lvl`,
 *   AUTH-REQ-009); honoured only where the mock is installed.
 *
 * A real-provider session also carries the level its provider confirmed and when (`rol`, `rat`),
 * refreshed every PAR-425 (plan-v0.2.0 §4.1 step 5). A version 1 or 2 cookie (from before v0.2.0),
 * or any other version, reads as no session, which logs everyone out once.
 * The cookie is HttpOnly and never reaches app code; the subject is never exposed.
 */
import { signToken, verifyToken } from "./signing.js";

/** PAR-250: session lifetime (7 days), in seconds. */
export const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
/** PAR-252: clock skew tolerated for an issued-at time in the future, in seconds. */
export const CLOCK_SKEW_SECONDS = 60;

/** The session format version (DEC-0524). */
export const SESSION_FORMAT_VERSION = 3;

/** A session from a real login provider: names the account through provider and subject. */
export interface ProviderSessionData {
  readonly id: string;
  readonly displayName: string | null;
  readonly provider: string;
  readonly subject: string;
  /** The level the provider confirmed, and when (seconds); refreshed every PAR-425 (DEC-0668, DEC-0672). */
  readonly role: SessionRole;
  /**
   * The session's expiry (seconds). `readSession` sets it; given to
   * `issueSession`, the new token keeps it, so a role refresh never extends a session.
   */
  readonly expiresAt?: number;
}

export interface SessionRole {
  readonly level: "user" | "admin";
  /** When the provider last confirmed the level, in seconds since the epoch. */
  readonly checkedAt: number;
}

/** A session created by the authentication mock: carries the level the test chose. */
export interface MockSessionData {
  readonly id: string;
  readonly displayName: string | null;
  readonly mockLevel: "user" | "admin";
}

export type SessionData = ProviderSessionData | MockSessionData;

interface SessionPayload {
  readonly v: number;
  readonly id: string;
  readonly name: string | null;
  readonly iat: number;
  readonly exp: number;
  readonly lvl?: "user" | "admin";
  readonly prv?: string;
  readonly sub?: string;
  /** A real-provider session's confirmed level and when it was confirmed (DEC-0668, DEC-0672): required. */
  readonly rol?: "user" | "admin";
  readonly rat?: number;
}

export function isMockSession(data: SessionData): data is MockSessionData {
  return "mockLevel" in data;
}

export async function issueSession(key: string, data: SessionData, nowMs: number): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const payload: SessionPayload = {
    v: SESSION_FORMAT_VERSION,
    id: data.id,
    name: data.displayName,
    iat,
    exp: isMockSession(data) || data.expiresAt === undefined ? iat + SESSION_LIFETIME_SECONDS : data.expiresAt,
    ...(isMockSession(data) ? { lvl: data.mockLevel } : providerFields(data)),
  };
  return signToken(key, "session", payload);
}

function providerFields(data: ProviderSessionData): Pick<SessionPayload, "prv" | "sub" | "rol" | "rat"> {
  return { prv: data.provider, sub: data.subject, rol: data.role.level, rat: data.role.checkedAt };
}

/** The session in a valid, current token; undefined for a tampered, expired, future-dated, malformed or older-format one. */
export async function readSession(key: string, token: string, nowMs: number): Promise<SessionData | undefined> {
  const payload = await verifyToken(key, "session", token);
  if (!isSessionPayload(payload)) return undefined;
  const now = nowMs / 1000;
  if (now >= payload.exp || payload.iat > now + CLOCK_SKEW_SECONDS) return undefined;
  if (payload.lvl !== undefined) return { id: payload.id, displayName: payload.name, mockLevel: payload.lvl };
  return {
    id: payload.id,
    displayName: payload.name,
    provider: payload.prv as string,
    subject: payload.sub as string,
    role: { level: payload.rol as "user" | "admin", checkedAt: payload.rat as number },
    expiresAt: payload.exp,
  };
}

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value !== "";

function isSessionPayload(value: unknown): value is SessionPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  const base =
    p["v"] === SESSION_FORMAT_VERSION &&
    nonEmpty(p["id"]) &&
    (p["name"] === null || typeof p["name"] === "string") &&
    Number.isFinite(p["iat"]) &&
    Number.isFinite(p["exp"]);
  if (!base) return false;
  const mock = p["lvl"] !== undefined;
  const real = p["prv"] !== undefined || p["sub"] !== undefined;
  if (mock === real) return false; // exactly one kind
  const role = p["rol"] !== undefined || p["rat"] !== undefined;
  if (mock) return !role && (p["lvl"] === "user" || p["lvl"] === "admin");
  if (!((p["rol"] === "user" || p["rol"] === "admin") && Number.isFinite(p["rat"]))) return false;
  return nonEmpty(p["prv"]) && nonEmpty(p["sub"]);
}
