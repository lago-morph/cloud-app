/**
 * The auth app's D1 store (plan §3): `users(sub, email, role, updated_at)`, `codes(code_hash, sub,
 * app, return_url, expires_at, used)`, the registry of approved app return URLs, and the short
 * sign-in state between `/start` and `/callback`. Codes and states are stored only as SHA-256
 * hashes. Times are epoch milliseconds, passed in, so tests control the clock.
 *
 * The registry is matched exactly (plan §4.1 step 2): no prefix, wildcard, case or encoding
 * normalisation. Only canonical URLs can be registered (`validReturnUrl`), so a registered URL is
 * also the form a browser sends.
 */
import type { AuthAppIdentity, AuthAppRole } from "../auth/auth-app-binding.js";
import { AUTH_APP_CODE_LIFETIME_MS } from "../auth/auth-app-binding.js";
import { SIGN_IN_TRANSACTION_MS } from "./params.js";
import { randomToken } from "./pkce.js";

/** The subset of Cloudflare's D1 binding the store uses. */
export interface D1Result<T> {
  readonly results: T[];
}
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}
export interface D1Like {
  prepare(query: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
}

export interface SignInState {
  readonly verifier: string;
  readonly nonce: string;
  readonly app: string;
  readonly returnUrl: string;
  /** The app's own `state`, handed back on the redirect to `return`. */
  readonly appState: string;
}

/** The schema, idempotent (DEC-0656: the Worker applies it once per isolate). */
export const AUTH_APP_SCHEMA: readonly string[] = [
  "CREATE TABLE IF NOT EXISTS users (sub TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin', 'user')), updated_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS codes (code_hash TEXT PRIMARY KEY, sub TEXT NOT NULL, app TEXT NOT NULL, return_url TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS registry (app TEXT NOT NULL, return_url TEXT NOT NULL, PRIMARY KEY (app, return_url))",
  "CREATE TABLE IF NOT EXISTS sign_ins (state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, nonce TEXT NOT NULL, app TEXT NOT NULL, return_url TEXT NOT NULL, app_state TEXT NOT NULL, expires_at INTEGER NOT NULL)",
];

export async function ensureSchema(db: D1Like): Promise<void> {
  await db.batch(AUTH_APP_SCHEMA.map((sql) => db.prepare(sql)));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- users ----

export async function upsertUser(db: D1Like, user: AuthAppIdentity, now: number): Promise<void> {
  await db
    .prepare("INSERT INTO users (sub, email, role, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (sub) DO UPDATE SET email = excluded.email, role = excluded.role, updated_at = excluded.updated_at")
    .bind(user.sub, user.email, user.role, now)
    .run();
}

const asRole = (v: unknown): AuthAppRole | null => (v === "admin" || v === "user" ? v : null);

export async function getRole(db: D1Like, sub: string): Promise<AuthAppRole | null> {
  const row = await db.prepare("SELECT role FROM users WHERE sub = ?1").bind(sub).first<{ role: string }>();
  return row === null ? null : asRole(row.role);
}

// ---- codes (PAR-414) ----

const CODE_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/** The code if it has the issued shape (43 base64url characters, 32 random bytes), else null. */
export function parseCode(code: string): string | null {
  return CODE_FORMAT.test(code) ? code : null;
}

export async function createCode(db: D1Like, input: { sub: string; app: string; returnUrl: string }, now: number): Promise<string> {
  const code = randomToken(32);
  await db.batch([
    db.prepare("DELETE FROM codes WHERE expires_at < ?1").bind(now),
    db
      .prepare("INSERT INTO codes (code_hash, sub, app, return_url, expires_at, used) VALUES (?1, ?2, ?3, ?4, ?5, 0)")
      .bind(await sha256Hex(code), input.sub, input.app, input.returnUrl, now + AUTH_APP_CODE_LIFETIME_MS),
  ]);
  return code;
}

/**
 * Uses the code up and returns the identity, or null (see the binding contract). One UPDATE
 * guarded by `used = 0` marks it used, so of concurrent redemptions exactly one gets the row.
 */
export async function redeemCode(db: D1Like, input: { code: string; app: string }, now: number): Promise<AuthAppIdentity | null> {
  const code = parseCode(input.code);
  if (code === null) return null;
  const taken = await db
    .prepare(
      "UPDATE codes SET used = 1 WHERE code_hash = ?1 AND app = ?2 AND used = 0 AND expires_at >= ?3 AND EXISTS (SELECT 1 FROM registry r WHERE r.app = codes.app AND r.return_url = codes.return_url) RETURNING sub",
    )
    .bind(await sha256Hex(code), input.app, now)
    .first<{ sub: string }>();
  if (taken === null) return null;
  const user = await db.prepare("SELECT sub, email, role FROM users WHERE sub = ?1").bind(taken.sub).first<{ sub: string; email: string; role: string }>();
  const role = user === null ? null : asRole(user.role);
  if (user === null || role === null) return null;
  return Object.freeze({ sub: user.sub, email: user.email, role });
}

// ---- registry ----

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * A URL that may be registered: absolute, already in the canonical form the URL parser gives it
 * (lower-case scheme and host, no default port, no dot segments), no credentials, no fragment;
 * https, or http only on localhost.
 */
export function validReturnUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const u = new URL(url);
  if (u.href !== url || u.username !== "" || u.password !== "" || u.hash !== "" || url.includes("#")) return false;
  return u.protocol === "https:" || (u.protocol === "http:" && LOCAL_HOSTS.has(u.hostname));
}

export async function registerReturnUrl(db: D1Like, app: string, url: string): Promise<void> {
  if (app === "" || !validReturnUrl(url)) throw new Error(`not a valid return URL for app ${JSON.stringify(app)}`);
  await db.prepare("INSERT INTO registry (app, return_url) VALUES (?1, ?2) ON CONFLICT DO NOTHING").bind(app, url).run();
}

export async function unregisterApp(db: D1Like, app: string): Promise<void> {
  await db.prepare("DELETE FROM registry WHERE app = ?1").bind(app).run();
}

/** Exact, case-sensitive string match of `(app, url)` against the registry. */
export async function isRegistered(db: D1Like, app: string, url: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS ok FROM registry WHERE app = ?1 AND return_url = ?2").bind(app, url).first();
  return row !== null;
}

// ---- sign-in state (PAR-416) ----

export async function saveSignIn(db: D1Like, state: string, s: SignInState, now: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM sign_ins WHERE expires_at < ?1").bind(now),
    db
      .prepare("INSERT INTO sign_ins (state_hash, verifier, nonce, app, return_url, app_state, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
      .bind(await sha256Hex(state), s.verifier, s.nonce, s.app, s.returnUrl, s.appState, now + SIGN_IN_TRANSACTION_MS),
  ]);
}

/** Removes and returns the sign-in for `state`, or null when unknown or expired (single use). */
export async function takeSignIn(db: D1Like, state: string, now: number): Promise<SignInState | null> {
  const row = await db
    .prepare("DELETE FROM sign_ins WHERE state_hash = ?1 RETURNING verifier, nonce, app, return_url, app_state, expires_at")
    .bind(await sha256Hex(state))
    .first<{ verifier: string; nonce: string; app: string; return_url: string; app_state: string; expires_at: number }>();
  if (row === null || now > row.expires_at) return null;
  return { verifier: row.verifier, nonce: row.nonce, app: row.app, returnUrl: row.return_url, appState: row.app_state };
}
