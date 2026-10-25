/**
 * Shared support for the password login provider and mail criteria (plan-auth.md item T1):
 * PWD-AC-001…007, MAIL-AC-001…005, AUTH-AC-013/014 and the password clause of SEC-AC-002.
 *
 * Written from docs/components/password.md, mail.md and auth.md, and the contracts
 * docs/contracts/http/internal/auth-password.openapi.yaml (routes, bodies, answers),
 * docs/contracts/ts/testing.d.ts (`passwordLoginProvider`, `mailSender`, `TestApp.mail`,
 * `MailMessage`) and docs/contracts/ts/internal/login-provider.d.ts — never from the
 * implementation. Where the framework's own `TestAppOptions`/`TestApp` types do not carry the
 * contract's password members yet, this module codes against the contract types.
 *
 * One `AuthBrowser` is one browser: it keeps its own cookies, and sends every request through
 * either the in-process reference app (`createTestApp`) or the run's target over HTTP (`dev`
 * locally, a test stage on a cloud). Its `mail` reads the mail the framework captured:
 * in-process `TestApp.mail`, under `dev` the reference app's `.mail/` (MAIL §2), on a cloud test
 * stage `GET /api/__framework/test-mail?to=` (MAIL-REQ-002).
 */
import { randomBytes, createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";
import type { LogEntry, MailMessage, TestApp as ContractTestApp, TestAppOptions as ContractTestAppOptions, TestMail } from "../../../../docs/contracts/ts/testing.js";
import { client, createClient, target, waitFor, type ComplianceClient } from "../../harness/index.js";
import { referenceTestApp, type TestAppOptions } from "../core/support/in-process.js";
import { DOCS, parameterNumber, REFERENCE_DIR } from "../core/support/repo.js";

export type { LogEntry, MailMessage };

// ---------------------------------------------------------------------------------------------
// Parameters (docs/parameters/parameters.md)
// ---------------------------------------------------------------------------------------------

function parameterRow(id: string): string {
  const text = readFileSync(join(DOCS, "parameters", "parameters.md"), "utf8");
  const row = text.split("\n").find((line) => line.startsWith(`| ${id} |`));
  if (row === undefined) throw new Error(`parameter ${id} not found in docs/parameters/parameters.md`);
  return row.split("|")[3]?.trim() ?? "";
}

export interface RateLimit {
  readonly max: number;
  readonly windowS: number;
}

/** A rate-limit parameter (`<max> per <window> s per IP`). */
export function rateLimit(id: string): RateLimit {
  const m = /(\d+)\s+per\s+(\d+)\s*s\b/.exec(parameterRow(id));
  if (m === null) throw new Error(`parameter ${id} is not of the form "<max> per <window> s"`);
  return { max: Number(m[1]), windowS: Number(m[2]) };
}

export const par = {
  /** PAR-254, characters. */
  minPassword: (): number => parameterNumber("PAR-254"),
  /** PAR-255, characters. */
  maxPassword: (): number => parameterNumber("PAR-255"),
  /** PAR-256 (hours) in ms. */
  verificationValidityMs: (): number => parameterNumber("PAR-256") * 3_600_000,
  /** PAR-257 (hours) in ms. */
  resetValidityMs: (): number => parameterNumber("PAR-257") * 3_600_000,
  /** PAR-258: sign-in. */
  signIn: (): RateLimit => rateLimit("PAR-258"),
  /** PAR-259: sign-up, forgot and resend. */
  emailSending: (): RateLimit => rateLimit("PAR-259"),
  /** PAR-122: the exact better-auth version. */
  betterAuthVersion: (): string => {
    const m = /\b(\d+\.\d+\.\d+)\b/.exec(parameterRow("PAR-122"));
    if (m?.[1] === undefined) throw new Error("PAR-122 has no version");
    return m[1];
  },
  /** PAR-244: `<salt hex>:<key hex>`, 16-byte salt, 64-byte key. */
  hashFormat: (): RegExp => /^[0-9a-f]{32}:[0-9a-f]{128}$/,
};

/** The fixed failed-login reasons of password.md §2 "Failed login log entry" (AUTH-REQ-010). */
export const FAILED_LOGIN_REASONS: readonly RegExp[] = [/^login failed: wrong credentials$/, /^login failed: not verified$/, /^login failed: rate limited$/, /^login failed: invalid token$/, /^login failed: provider unavailable \([^()]+\)$/];

// ---------------------------------------------------------------------------------------------
// Test values
// ---------------------------------------------------------------------------------------------

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

/** A fresh address on a reserved name (MAIL-REQ-003: tests use `example.test`). */
export function testAddress(label: string): string {
  return `${label}-${hex(6)}@example.test`;
}

/** A recognisable random password of exactly `length` characters (letters and digits). */
export function testPassword(length = 20): string {
  let out = `Pw${hex(Math.ceil(length / 2) + 4)}`;
  while (out.length < length) out += hex(8);
  return out.slice(0, length);
}

/** A display name that is not derived from any address. */
export function testDisplayName(label: string): string {
  return `${label} ${hex(3)}`;
}

/** A client IP of its own for one test client (PWD-REQ-006 counts per IP; DEC-0516 P7). */
export function testIp(): string {
  const b = randomBytes(3);
  return `10.${String(b[0] ?? 1)}.${String(b[1] ?? 1)}.${String((b[2] ?? 1) % 250 + 2)}`;
}

export interface Account {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

export function newAccount(label: string): Account {
  return { email: testAddress(label), password: testPassword(), displayName: testDisplayName(`PWD ${label}`) };
}

// ---------------------------------------------------------------------------------------------
// User ID derivation (auth.md §2 "User ID", DEC-0067)
// ---------------------------------------------------------------------------------------------

function base32(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31] ?? "";
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31] ?? "";
  return out;
}

/** `u_` + the first 26 characters of base32(SHA-256(`<provider id>:<subject>`)). Letter case is not specified. */
export function deriveUserId(providerId: string, subject: string): string {
  return `u_${base32(createHash("sha256").update(`${providerId}:${subject}`, "utf8").digest()).slice(0, 26)}`;
}

export const USER_ID = /^u_[A-Za-z2-7]{26}$/;

// ---------------------------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------------------------

export interface Answer {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  /** ErrorResponse `error.code`, when the body is one. */
  readonly code: string | undefined;
  readonly requestId: string | undefined;
  readonly setCookies: readonly string[];
  json<T = unknown>(): T;
}

function answerOf(method: string, path: string, status: number, headers: Headers, text: string): Answer {
  let code: string | undefined;
  let requestId: string | undefined;
  try {
    const body = JSON.parse(text) as { error?: { code?: unknown; requestId?: unknown } };
    if (typeof body.error?.code === "string") code = body.error.code;
    if (typeof body.error?.requestId === "string") requestId = body.error.requestId;
  } catch {
    // not JSON
  }
  return {
    method,
    path,
    status,
    headers,
    text,
    code,
    requestId,
    setCookies: headers.getSetCookie(),
    json<T>(): T {
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`${method} ${path}: status ${String(status)}, the body is not JSON: ${text.slice(0, 200)}`);
      }
    },
  };
}

/** A one-line description of an answer, for assertion messages. */
export function describeAnswer(a: Answer): string {
  return `${a.method} ${a.path} → ${String(a.status)} ${a.code ?? ""} ${a.text.slice(0, 300)}`;
}

export function expectAnswer(a: Answer, status: number, code?: string): Answer {
  expect(a.status, describeAnswer(a)).toBe(status);
  if (code !== undefined) expect(a.code, describeAnswer(a)).toBe(code);
  return a;
}

/** The JSON success body of the internal contract, e.g. `{ result: "check-email" }`. */
export function expectResult(a: Answer, result: string): Answer {
  expect(a.status, describeAnswer(a)).toBe(200);
  expect(a.json(), describeAnswer(a)).toStrictEqual({ result });
  return a;
}

/** The `Location` of a 303 form answer, resolved against `origin`. */
export function seeOther(a: Answer, origin: string): URL {
  expect(a.status, describeAnswer(a)).toBe(303);
  const location = a.headers.get("location");
  expect(location, `${describeAnswer(a)}: Location`).not.toBeNull();
  const url = new URL(location ?? "", origin);
  expect(url.origin, `${describeAnswer(a)}: the redirect stays on the public origin`).toBe(origin);
  return url;
}

/**
 * An answer reduced to what PWD-REQ-005 compares: status, headers other than the request ID
 * (and the transport's `Date`), and the body with any request ID blanked.
 */
export function comparable(a: Answer): { status: number; headers: [string, string][]; body: string } {
  const ids = new Set<string>();
  if (a.requestId !== undefined) ids.add(a.requestId);
  const headers: [string, string][] = [];
  for (const [k, v] of a.headers) {
    if (/request-?id/i.test(k)) {
      ids.add(v);
      continue;
    }
    if (k.toLowerCase() === "date") continue;
    headers.push([k.toLowerCase(), v]);
  }
  const blank = (text: string): string => {
    let out = text;
    for (const id of ids) if (id !== "") out = out.split(id).join("<request-id>");
    return out;
  };
  const sorted = headers.map(([k, v]): [string, string] => [k, blank(v)]).sort((x, y) => (x[0] === y[0] ? (x[1] < y[1] ? -1 : 1) : x[0] < y[0] ? -1 : 1));
  const body = blank(a.text);
  return { status: a.status, headers: sorted, body };
}

// ---------------------------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------------------------

export interface MailReader {
  /** The latest captured message to `address`, or undefined. */
  latest(address: string): Promise<MailMessage | undefined>;
  /** Every captured message to `address`, oldest first (on a cloud test stage: at most the latest). */
  all(address: string): Promise<readonly MailMessage[]>;
}

/** Waits (bounded) for a message to `address` that `accept` accepts; `after` messages are ignored. */
export async function waitForMail(reader: MailReader, address: string, what: string, options: { readonly after?: number; readonly accept?: (m: MailMessage) => boolean; readonly timeoutMs?: number } = {}): Promise<MailMessage> {
  const after = options.after ?? 0;
  return waitFor(
    async () => {
      const messages = await reader.all(address);
      const fresh = messages.slice(after).filter((m) => options.accept?.(m) ?? true);
      return fresh[fresh.length - 1];
    },
    // performance.now: tests that fake `Date` must not stop this bound.
    { what: `a ${what} mail to the test address`, timeoutMs: options.timeoutMs ?? 20_000, intervalMs: 200, now: () => performance.now() },
  );
}

/** Waits `ms` with a real timer, then returns how many messages `address` has. */
export async function mailCountAfter(reader: MailReader, address: string, ms = 2_000): Promise<number> {
  await new Promise((r) => setTimeout(r, ms));
  return (await reader.all(address)).length;
}

/** A fingerprint of the latest message to `address` ("" when there is none), to tell that no new mail arrived. */
export async function latestMailKey(reader: MailReader, address: string): Promise<string> {
  const m = await reader.latest(address);
  return m === undefined ? "" : JSON.stringify([m.sentAt, m.subject, m.text]);
}

export type LinkKind = "verify" | "reset";

const LINK = /https?:\/\/[^\s"'<>()]+/g;

/** Every URL in a message's text and HTML. */
export function linksIn(message: MailMessage): URL[] {
  const out: URL[] = [];
  for (const raw of `${message.text}\n${message.html}`.match(LINK) ?? []) {
    try {
      out.push(new URL(raw.replace(/&amp;/g, "&").replace(/[.,;]+$/, "")));
    } catch {
      // not a URL
    }
  }
  return out;
}

/**
 * The token of the message's verification or reset link. The link must open the framework's
 * GET page (`/api/auth/verify?token=` or `/api/auth/reset?token=`, auth-password.openapi.yaml)
 * on the public origin (MAIL-REQ-004), and every link in the message must be on that origin.
 */
export function linkToken(message: MailMessage, kind: LinkKind, publicOrigin: string): string {
  const links = linksIn(message);
  for (const l of links) expect(l.origin, `link ${l.href} in "${message.subject}" is on the public origin`).toBe(publicOrigin);
  const link = links.find((l) => l.pathname === `/api/auth/${kind}` && (l.searchParams.get("token") ?? "") !== "");
  expect(link, `the "${message.subject}" mail has a /api/auth/${kind}?token= link (links: ${links.map((l) => l.pathname).join(", ")})`).toBeDefined();
  return link?.searchParams.get("token") ?? "";
}

export function hasLink(message: MailMessage, kind: LinkKind): boolean {
  return linksIn(message).some((l) => l.pathname === `/api/auth/${kind}` && (l.searchParams.get("token") ?? "") !== "");
}

/** In-process: `TestApp.mail`. */
export function testAppMail(mail: TestMail): MailReader {
  return {
    latest: (address) => mail.lastTo(address),
    async all(address) {
      return (await mail.all()).filter((m) => m.to.toLowerCase() === address.toLowerCase());
    },
  };
}

/** One `.mail/<timestamp>-<id>.json` file (MAIL §2): `{ to, subject, text, html, time }`. */
export interface DevMailFile {
  readonly file: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly time: string;
}

/** The files of an app's `.mail/`, in name (timestamp) order. */
export async function devMailFiles(appDir = REFERENCE_DIR): Promise<DevMailFile[]> {
  const dir = join(appDir, ".mail");
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out: DevMailFile[] = [];
  for (const name of names) {
    try {
      const v = JSON.parse(await readFile(join(dir, name), "utf8")) as Partial<Record<keyof DevMailFile, unknown>>;
      out.push({ file: name, to: String(v.to ?? ""), subject: String(v.subject ?? ""), text: String(v.text ?? ""), html: String(v.html ?? ""), time: String(v.time ?? "") });
    } catch {
      // being written
    }
  }
  return out;
}

/** Under `dev`: the app's `.mail/`. */
export function devMail(appDir = REFERENCE_DIR): MailReader {
  const all = async (address: string): Promise<MailMessage[]> =>
    (await devMailFiles(appDir))
      .filter((f) => f.to.toLowerCase().includes(address.toLowerCase()))
      .map((f) => ({ to: f.to, from: "", subject: f.subject, text: f.text, html: f.html, sentAt: f.time }));
  return {
    all,
    async latest(address) {
      const list = await all(address);
      return list[list.length - 1];
    },
  };
}

/** On a cloud test stage: `GET /api/__framework/test-mail?to=` (latest message, or 404). */
export function testStageMail(c: ComplianceClient): MailReader {
  const latest = async (address: string): Promise<MailMessage | undefined> => {
    const r = await c.get(`/api/__framework/test-mail?to=${encodeURIComponent(address)}`);
    if (r.status === 404) return undefined;
    c.expectStatus(r, 200);
    return r.json<MailMessage>();
  };
  return {
    latest,
    async all(address) {
      const m = await latest(address);
      return m === undefined ? [] : [m];
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Browsers
// ---------------------------------------------------------------------------------------------

export interface SendOptions {
  /** `Origin`: default the public origin; `false` omits it (HTTP only: in-process always sends one). */
  readonly origin?: string | false;
  /** `CF-Connecting-IP`. */
  readonly ip?: string;
  /** Send the body as a form (`application/x-www-form-urlencoded`) and expect the 303 form answer. */
  readonly form?: boolean;
  readonly headers?: Readonly<Record<string, string>>;
  /** Send this browser's cookies (default true). */
  readonly cookies?: boolean;
}

export interface AuthBrowser {
  readonly publicOrigin: string;
  readonly mail: MailReader;
  post(path: string, body: Readonly<Record<string, string>>, options?: SendOptions): Promise<Answer>;
  get(path: string, options?: SendOptions): Promise<Answer>;
  /** The browser's cookies (name → value). */
  cookies(): Record<string, string>;
  clearCookies(): void;
}

function cookieJar(): { remember(headers: Headers): void; header(): string | undefined; all(): Record<string, string>; clear(): void } {
  const jar = new Map<string, string>();
  return {
    remember(headers) {
      for (const raw of headers.getSetCookie()) {
        const [pair = "", ...attrs] = raw.split(";");
        const eq = pair.indexOf("=");
        if (eq <= 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        const cleared = value === "" || attrs.some((a) => /^\s*max-age\s*=\s*(0|-\d+)\s*$/i.test(a)) || attrs.some((a) => /^\s*expires\s*=/i.test(a) && Date.parse(a.split("=").slice(1).join("=")) < Date.now());
        if (cleared) jar.delete(name);
        else jar.set(name, value);
      }
    },
    header: () => (jar.size === 0 ? undefined : [...jar].map(([k, v]) => `${k}=${v}`).join("; ")),
    all: () => Object.fromEntries(jar),
    clear: () => jar.clear(),
  };
}

function requestHeaders(body: Readonly<Record<string, string>> | undefined, options: SendOptions, publicOrigin: string, cookie: string | undefined, method: string): { headers: Headers; payload: string | undefined } {
  const headers = new Headers(options.headers);
  if (!options.form) headers.set("accept", "application/json");
  if (options.ip !== undefined) headers.set("cf-connecting-ip", options.ip);
  const origin = options.origin ?? (method === "GET" ? false : publicOrigin);
  if (origin !== false) headers.set("origin", origin);
  if (cookie !== undefined && options.cookies !== false) headers.set("cookie", cookie);
  let payload: string | undefined;
  if (body !== undefined) {
    if (options.form) {
      headers.set("content-type", "application/x-www-form-urlencoded");
      payload = new URLSearchParams(body).toString();
    } else {
      headers.set("content-type", "application/json");
      payload = JSON.stringify(body);
    }
  }
  return { headers, payload };
}

/** The in-process app as `createTestApp` returns it with `passwordLoginProvider` (testing.d.ts). */
export type PasswordTestApp = Pick<ContractTestApp, "request" | "mail" | "logs" | "dispose">;

/** The contract options the password tests use (testing.d.ts `TestAppOptions`). */
export type PasswordAppOptions = Pick<ContractTestAppOptions, "mailSender" | "config" | "secrets">;

/** The in-process public origin (local.md "Test apps"). */
export const IN_PROCESS_ORIGIN = "http://localhost:8787";

/** The value given to the reference app's declared secret `apiKey` in-process. */
export const IN_PROCESS_SECRET = "c-t1-pwd-in-process-secret-value-7f3a";

const openedApps: PasswordTestApp[] = [];

/**
 * A fresh in-process reference app with the real email-and-password provider and its
 * in-memory outbox (`createTestApp(app, { passwordLoginProvider: true })`, testing.d.ts).
 */
export async function openPasswordApp(options: PasswordAppOptions = {}): Promise<PasswordTestApp> {
  const requested = { ...options, secrets: { apiKey: IN_PROCESS_SECRET, ...(options.secrets ?? {}) }, passwordLoginProvider: true };
  const framework: TestAppOptions = requested;
  const app = await referenceTestApp(framework);
  const mail = (app as Partial<Pick<ContractTestApp, "mail">>).mail;
  if (mail === undefined) {
    await app.dispose();
    throw new Error("createTestApp(…, { passwordLoginProvider: true }) returned a TestApp without `mail` (TestApp.mail, docs/contracts/ts/testing.d.ts)");
  }
  const opened: PasswordTestApp = { request: (p, i) => app.request(p, i), mail, logs: () => app.logs(), dispose: () => app.dispose() };
  openedApps.push(opened);
  return opened;
}

/** Disposes every app `openPasswordApp` opened (afterEach). */
export async function disposePasswordApps(): Promise<void> {
  await Promise.all(openedApps.splice(0).map((a) => a.dispose()));
}

/** A browser on an in-process app. */
export function inProcessBrowser(app: PasswordTestApp): AuthBrowser {
  const jar = cookieJar();
  const send = async (method: string, path: string, body: Readonly<Record<string, string>> | undefined, options: SendOptions = {}): Promise<Answer> => {
    if (options.origin === false) throw new Error("in-process requests always carry an Origin (testing.d.ts); send a missing Origin over HTTP");
    const { headers, payload } = requestHeaders(body, options, IN_PROCESS_ORIGIN, jar.header(), method);
    const response = await app.request(path, { method, headers, redirect: "manual", ...(payload === undefined ? {} : { body: payload }) });
    jar.remember(response.headers);
    return answerOf(method, path, response.status, response.headers, await response.text());
  };
  return {
    publicOrigin: IN_PROCESS_ORIGIN,
    mail: testAppMail(app.mail),
    post: (path, body, options) => send("POST", path, body, options),
    get: (path, options) => send("GET", path, undefined, options),
    cookies: () => jar.all(),
    clearCookies: () => jar.clear(),
  };
}

/**
 * A browser over HTTP: by default on the run's target (`dev` locally, the test stage on a cloud);
 * with `baseUrl` and `appDir`, on another `dev` server whose mail is in `<appDir>/.mail/`.
 */
export function httpBrowser(options: { readonly baseUrl?: string; readonly appDir?: string } = {}): AuthBrowser {
  const c = options.baseUrl === undefined ? client() : createClient({ baseUrl: options.baseUrl });
  const jar = cookieJar();
  const publicOrigin = c.baseUrl;
  const send = async (method: string, path: string, body: Readonly<Record<string, string>> | undefined, options: SendOptions = {}): Promise<Answer> => {
    const { headers, payload } = requestHeaders(body, options, publicOrigin, jar.header(), method);
    // The harness client adds Origin on POSTs by default: pass ours explicitly (false = omit).
    const origin = headers.get("origin");
    headers.delete("origin");
    const r = await c.request(method, path, { headers: Object.fromEntries(headers), origin: origin ?? false, ...(payload === undefined ? {} : { body: payload }) });
    jar.remember(r.headers);
    return answerOf(method, path, r.status, r.headers, r.text);
  };
  return {
    publicOrigin,
    mail: options.appDir !== undefined ? devMail(options.appDir) : target().target === "local" ? devMail() : testStageMail(c),
    post: (path, body, options) => send("POST", path, body, options),
    get: (path, options) => send("GET", path, undefined, options),
    cookies: () => jar.all(),
    clearCookies: () => jar.clear(),
  };
}

// ---------------------------------------------------------------------------------------------
// Flows (auth-password.openapi.yaml)
// ---------------------------------------------------------------------------------------------

export const ROUTES = {
  signUp: "/api/auth/password/sign-up",
  signIn: "/api/auth/password/sign-in",
  resend: "/api/auth/password/resend",
  verify: "/api/auth/password/verify",
  forgot: "/api/auth/password/forgot",
  reset: "/api/auth/password/reset",
} as const;

export const signUp = (b: AuthBrowser, a: Account, o?: SendOptions): Promise<Answer> => b.post(ROUTES.signUp, { email: a.email, password: a.password, displayName: a.displayName }, o);
export const signIn = (b: AuthBrowser, email: string, password: string, o?: SendOptions & { readonly returnTo?: string }): Promise<Answer> =>
  b.post(ROUTES.signIn, { email, password, ...(o?.returnTo === undefined ? {} : { returnTo: o.returnTo }) }, o);
export const resend = (b: AuthBrowser, email: string, o?: SendOptions): Promise<Answer> => b.post(ROUTES.resend, { email }, o);
export const verify = (b: AuthBrowser, token: string, o?: SendOptions): Promise<Answer> => b.post(ROUTES.verify, { token }, o);
export const forgot = (b: AuthBrowser, email: string, o?: SendOptions): Promise<Answer> => b.post(ROUTES.forgot, { email }, o);
export const reset = (b: AuthBrowser, token: string, password: string, o?: SendOptions): Promise<Answer> => b.post(ROUTES.reset, { token, password }, o);

export interface Me {
  readonly level: string;
  readonly id?: string;
  readonly displayName?: string | null;
  readonly unlistedId?: string;
}

export async function me(b: AuthBrowser): Promise<Me> {
  const r = await b.get("/api/auth/me");
  expectAnswer(r, 200);
  return r.json<Me>();
}

/** Sign-up, the verification mail, verify: a verified account. Returns the verification mail. */
export async function createVerifiedAccount(b: AuthBrowser, a: Account, ip: string): Promise<MailMessage> {
  expectResult(await signUp(b, a, { ip }), "check-email");
  const mail = await waitForMail(b.mail, a.email, "verification", { accept: (m) => hasLink(m, "verify") });
  expectResult(await verify(b, linkToken(mail, "verify", b.publicOrigin), { ip }), "verified");
  return mail;
}

/** The session cookie name of the run's target (auth.md §2): `session_local` in-process and under `dev`. */
export function sessionCookieNameFor(b: AuthBrowser): string {
  return b.publicOrigin.startsWith("https:") ? "__Host-session" : "session_local";
}

// ---------------------------------------------------------------------------------------------
// The local D1 database of a `dev` app (Wrangler's persisted state)
// ---------------------------------------------------------------------------------------------

/** The D1 database files of an app's `.wrangler/` (Miniflare's `metadata.sqlite` is not one). */
export function localD1Files(appDir = REFERENCE_DIR): string[] {
  const found: string[] = [];
  const root = join(appDir, ".wrangler");
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".sqlite") && entry !== "metadata.sqlite" && full.includes(`${sep}d1${sep}`)) found.push(full);
    }
  };
  if (existsSync(root)) walk(root);
  return found;
}

/** Rows of `table` in whichever local D1 database has it (read-only). */
export function localRows(table: string, appDir = REFERENCE_DIR): Record<string, unknown>[] {
  for (const file of localD1Files(appDir)) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      if (has === undefined) continue;
      return db.prepare(`SELECT * FROM "${table}"`).all().map((r) => ({ ...r }));
    } finally {
      db.close();
    }
  }
  throw new Error(`no local D1 database of ${appDir} has the table ${table}`);
}

/** Rows with any column equal to `value`. */
export function rowsWith(rows: readonly Record<string, unknown>[], value: string): Record<string, unknown>[] {
  return rows.filter((r) => Object.values(r).some((v) => v === value));
}

/** The credential library's user ID (the provider subject) of `email`, from `__framework_auth_user`. */
export function localSubjectOf(email: string, appDir = REFERENCE_DIR): string {
  const rows = localRows("__framework_auth_user", appDir).filter((r) => Object.values(r).some((v) => typeof v === "string" && v.toLowerCase() === email.toLowerCase()));
  expect(rows.length, `one __framework_auth_user row for the test address`).toBe(1);
  const id = rows[0]?.["id"];
  expect(typeof id, "the user row's id").toBe("string");
  return String(id);
}

/** Whether `needle` occurs in the bytes of any local D1 file (database, WAL and journal). */
export function localDatabaseContains(needle: string, appDir = REFERENCE_DIR): string[] {
  const hits: string[] = [];
  for (const file of localD1Files(appDir)) {
    for (const f of [file, `${file}-wal`, `${file}-journal`, `${file}-shm`]) {
      if (existsSync(f) && readFileSync(f).includes(needle)) hits.push(f);
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------
// Scans
// ---------------------------------------------------------------------------------------------

/** Labels of the needles found in `haystack` (case-insensitive for addresses). */
export function found(haystack: string, needles: Readonly<Record<string, string>>): string[] {
  const lower = haystack.toLowerCase();
  return Object.entries(needles)
    .filter(([, n]) => n !== "" && lower.includes(n.toLowerCase()))
    .map(([label]) => label);
}

export function answerText(a: Answer): string {
  return `${String(a.status)}\n${[...a.headers].map(([k, v]) => `${k}: ${v}`).join("\n")}\n${a.text}`;
}

export function mailText(m: MailMessage): string {
  return `${m.subject}\n${m.text}\n${m.html}`;
}

export function logText(entries: readonly LogEntry[]): string[] {
  return entries.map((e) => JSON.stringify(e));
}
