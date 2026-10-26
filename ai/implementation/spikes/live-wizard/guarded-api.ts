/**
 * The guarded Cloudflare API layer of the setup wizard's live milestone pass
 * (plan-setup-wizard §6 "Live, in a milestone pass"). The pass runs against the owner's account
 * with the environment's dashboard-made token (`CLOUDFLARE_API_TOKEN`, which holds "Account API
 * Tokens Write"), so every request goes through hard guards, enforced here before a request is sent:
 *
 * - **The owner's token is never changed or deleted.** At start, the environment token's own ID is
 *   read (`GET /accounts/<a>/tokens/verify`); any DELETE, PUT, PATCH or POST on a tokens path
 *   (`/accounts/<a>/tokens/…` or `/user/tokens/…`) that names that ID, or another protected ID, is
 *   refused with `LivePassRefusal`. The IDs are also handed to the state machine's own guard
 *   (`protectedTokenIds`, DEC-0589).
 * - **Only short-lived wizard tokens are created.** A token create (`POST /accounts/<a>/tokens` or
 *   `POST /user/tokens`) must be named `prototype-compliance-wizard-<suffix>` and expire within
 *   `MAX_TOKEN_LIFETIME_MS` (2 hours); otherwise it is refused. The prefix is under the compliance
 *   harness's `prototype-compliance-` (test-tokens.ts), so its leftover check also reports them.
 * - **A call budget.** At most `PASS_CALL_LIMIT` calls per pass and `WINDOW_CALL_LIMIT` per rolling
 *   `WINDOW_MS`; reaching a limit, or any HTTP 429, stops the pass: that call and every later one
 *   rejects with `LivePassStopped`. A 401 stops further use of that token (the harness's
 *   `guardFetch`, token-guard.ts).
 * - **Redaction.** `redact` removes every token value (the environment's, and each value an answer
 *   carries), the account ID, zone IDs, token IDs and the account's `workers.dev` subdomain (read
 *   once at start, never printed), plus any remaining 32-hex ID and `<x>.<sub>.workers.dev` host as
 *   a backstop. `print` and `redactingIo` pass everything through it.
 * - **Cleanup** (`cleanup`): lists the account's tokens, deletes only `prototype-compliance-wizard-*`
 *   (never a protected ID), lists again and prints only names as proof.
 *
 * Injection into the framework: `pass.apiFor` is a `CloudflareSetupDeps.apiFor` (every token's API
 * shares this pass's guards and budget), `pass.protectedTokenIds` is `CloudflareSetupDeps.protectedTokenIds`,
 * and `pass.redactingIo(io)` wraps the run's `ProvisionIo`.
 */
import { createCloudflareApi, type ApiReply, type CloudflareApi } from "../../../../packages/framework/src/provision/cloudflare/api.js";
import { redact as redactText, type Redaction } from "../../../../packages/framework/src/evidence/writer.js";
import { listTestTokens } from "../../../../tests/compliance/harness/test-tokens.js";
import { guardFetch, MAIN_TOKEN_PURPOSE } from "../../../../tests/compliance/harness/token-guard.js";

export const WIZARD_TOKEN_PREFIX = "prototype-compliance-wizard-";
/** `prototype-compliance-wizard-<suffix>`: lowercase letters, digits and hyphens. */
const WIZARD_TOKEN_NAME = /^prototype-compliance-wizard-[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_TOKEN_LIFETIME_MS = 2 * 60 * 60_000;
export const PASS_CALL_LIMIT = 2_000;
export const WINDOW_CALL_LIMIT = 1_000;
export const WINDOW_MS = 5 * 60_000;

/** A request the guards refused; nothing was sent. The pass may go on. */
export class LivePassRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LivePassRefusal";
  }
}

/** The pass stopped (budget reached, or a 429); no further request is sent. */
export class LivePassStopped extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LivePassStopped";
  }
}

export interface LivePassOptions {
  readonly accountId: string;
  /** The environment's token (`CLOUDFLARE_API_TOKEN`); its ID is protected. */
  readonly envToken: string;
  /** More token IDs never to change or delete. */
  readonly protectedTokenIds?: readonly string[];
  /** More values to redact (for example a bootstrap token value). */
  readonly secrets?: readonly string[];
  readonly fetch?: typeof fetch;
  /** Milliseconds since the epoch. */
  readonly now?: () => number;
  /** Receives lines already redacted (default: stdout). */
  readonly log?: (line: string) => void;
  readonly limits?: { readonly perPass?: number; readonly perWindow?: number; readonly windowMs?: number };
}

export interface LivePass {
  /** The environment token's own ID and any given: never changed or deleted. Not to be printed. */
  readonly protectedTokenIds: readonly string[];
  /** The guarded API with the environment token. */
  readonly api: CloudflareApi;
  /** The guarded API with any token (for `CloudflareSetupDeps.apiFor`); its value joins the redactions. */
  apiFor(token: string): CloudflareApi;
  /** The environment token's verify answer: active, and whether it has an expiry. */
  readonly envTokenStatus: { readonly status: string; readonly hasExpiry: boolean };
  redact(text: string): string;
  /** Adds a value to redact. */
  addSecret(value: string, replacement?: string): void;
  /** Logs one line, redacted. */
  print(line: string): void;
  /** A `ProvisionIo` whose output is redacted before it reaches `io`. */
  redactingIo<T extends { stdout(text: string): void; stderr(text: string): void }>(io: T): T;
  /** Calls sent so far (whole pass, and in the current window). */
  calls(): { readonly pass: number; readonly window: number };
  /** Why the pass stopped, or undefined. */
  stopReason(): string | undefined;
  /** Deletes every `prototype-compliance-wizard-*` account token, then lists again; resolves to the names still listed with that prefix. */
  cleanup(): Promise<readonly string[]>;
}

const TOKENS_PATH = /^\/(?:accounts\/[^/]+|user)\/tokens(?:\/|$)/;
const TOKEN_CREATE_PATH = /^\/(?:accounts\/[^/]+|user)\/tokens\/?$/;
const HEX32 = /\b[0-9a-f]{32}\b/gi;
const WORKERS_DEV_HOST = /\b([a-z0-9-]+)\.([a-z0-9-]+)\.workers\.dev\b/gi;

const pathOnly = (path: string): string => {
  const p = path.split("?")[0] ?? "";
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
};

/**
 * The guard's verdict on one request, before it is sent: a refusal message, or undefined.
 * `protectedIds` are compared case-insensitively against every segment of a tokens path.
 */
export function refusalOf(method: string, path: string, body: unknown, protectedIds: ReadonlySet<string>, nowMs: number): string | undefined {
  const p = pathOnly(path);
  if (!TOKENS_PATH.test(p) || method === "GET") return undefined;
  const segments = p.split("/").map((s) => s.toLowerCase());
  if (segments.some((s) => protectedIds.has(s))) return `${method} on a protected token's ID refused (the environment token, or another protected one, is never changed or deleted)`;
  if (method === "POST" && TOKEN_CREATE_PATH.test(p)) {
    const b = (typeof body === "object" && body !== null ? body : {}) as { name?: unknown; expires_on?: unknown };
    if (typeof b.name !== "string" || !WIZARD_TOKEN_NAME.test(b.name)) return `token create refused: the name must be ${WIZARD_TOKEN_PREFIX}<suffix>`;
    const expires = typeof b.expires_on === "string" ? Date.parse(b.expires_on) : NaN;
    if (Number.isNaN(expires)) return `token create refused for ${b.name}: no expires_on`;
    if (expires <= nowMs || expires > nowMs + MAX_TOKEN_LIFETIME_MS) return `token create refused for ${b.name}: expires_on must be within 2 hours from now`;
  }
  return undefined;
}

/** Values an answer carries that must be redacted: token values, token IDs, zone IDs, account IDs. */
export function secretsIn(path: string, body: unknown): Redaction[] {
  const p = pathOnly(path);
  const out: Redaction[] = [];
  const result = (body as { result?: unknown } | null)?.result;
  const items = Array.isArray(result) ? result : result === undefined || result === null ? [] : [result];
  const add = (value: unknown, replacement: string) => {
    if (typeof value === "string" && value !== "") out.push({ value, replacement });
  };
  if (TOKENS_PATH.test(p)) {
    if (/\/value$/.test(p)) add(result, "<token-value>");
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      add((item as { value?: unknown }).value, "<token-value>");
      add((item as { id?: unknown }).id, "<token-id>");
    }
  }
  if (/^\/zones(?:\/|$|\?)/.test(p)) for (const item of items) if (typeof item === "object" && item !== null) add((item as { id?: unknown }).id, "<zone-id>");
  if (/^\/accounts\/?$/.test(p)) for (const item of items) if (typeof item === "object" && item !== null) add((item as { id?: unknown }).id, "<account-id>");
  return out;
}

export async function startLivePass(options: LivePassOptions): Promise<LivePass> {
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const perPass = options.limits?.perPass ?? PASS_CALL_LIMIT;
  const perWindow = options.limits?.perWindow ?? WINDOW_CALL_LIMIT;
  const windowMs = options.limits?.windowMs ?? WINDOW_MS;
  const doFetch = options.fetch ?? fetch;
  const { accountId, envToken } = options;
  if (accountId === "" || envToken === "") throw new LivePassRefusal("live pass: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must both be set");

  const redactions: Redaction[] = [
    { value: envToken, replacement: "<CLOUDFLARE_API_TOKEN>" },
    { value: accountId, replacement: "<account-id>" },
    ...(options.secrets ?? []).map((value) => ({ value, replacement: "<secret>" })),
  ];
  redactions.sort((a, b) => b.value.length - a.value.length);
  const known = new Set(redactions.map((r) => r.value));
  const addSecret = (value: string, replacement = "<secret>") => {
    if (value === "" || known.has(value)) return;
    known.add(value);
    // Longer values first, so a value that contains another is replaced whole.
    redactions.push({ value, replacement });
    redactions.sort((a, b) => b.value.length - a.value.length);
  };
  const redact = (text: string): string =>
    redactText(text, redactions)
      .replace(WORKERS_DEV_HOST, (_m, host: string) => `${host}.<subdomain>.workers.dev`)
      .replace(HEX32, "<id>");
  const print = (line: string) => log(redact(line));

  const protectedIds = new Set((options.protectedTokenIds ?? []).map((id) => id.toLowerCase()));
  for (const id of protectedIds) addSecret(id, "<protected-token-id>");
  let stopped: string | undefined;
  const sent: number[] = [];
  let total = 0;

  const transports = new Map<string, CloudflareApi>();
  const transport = (token: string): CloudflareApi => {
    let t = transports.get(token);
    if (t === undefined) {
      const purpose = token === envToken ? MAIN_TOKEN_PURPOSE : "a token of the live wizard pass";
      t = createCloudflareApi({ token, fetch: guardFetch(doFetch, token, purpose) });
      transports.set(token, t);
    }
    return t;
  };

  const guarded = (token: string): CloudflareApi => {
    addSecret(token, token === envToken ? "<CLOUDFLARE_API_TOKEN>" : "<token-value>");
    const send = transport(token);
    return async (method, path, body) => {
      if (stopped !== undefined) throw new LivePassStopped(`live pass stopped earlier (${stopped}); ${method} not sent`);
      const refusal = refusalOf(method, path, body, protectedIds, now());
      if (refusal !== undefined) throw new LivePassRefusal(redact(`live pass guard: ${refusal}`));
      const t = now();
      while (sent.length > 0 && (sent[0] ?? 0) <= t - windowMs) sent.shift();
      if (total >= perPass) {
        stopped = `the pass budget of ${String(perPass)} calls is used`;
        throw new LivePassStopped(`live pass stopped: ${stopped}`);
      }
      if (sent.length >= perWindow) {
        stopped = `${String(perWindow)} calls in ${String(windowMs / 60_000)} minutes`;
        throw new LivePassStopped(`live pass stopped: ${stopped}`);
      }
      total++;
      sent.push(t);
      const reply: ApiReply = await send(method, path, body);
      for (const s of secretsIn(path, reply.body)) addSecret(s.value, s.replacement);
      if (reply.status === 429) {
        stopped = `HTTP 429 on ${method}`;
        throw new LivePassStopped(`live pass stopped: ${stopped} (rate limited)`);
      }
      return reply;
    };
  };

  const api = guarded(envToken);

  // The environment token's own ID, read before anything else is sent.
  const verify = await api("GET", `/accounts/${accountId}/tokens/verify`);
  const v = (verify.body as { success?: unknown; result?: { id?: unknown; status?: unknown; expires_on?: unknown } } | null) ?? {};
  if (verify.status !== 200 || v.success !== true || typeof v.result?.id !== "string" || v.result.id === "") {
    throw new LivePassRefusal(`live pass: the environment token could not be verified as an account token (HTTP ${String(verify.status)}); nothing else was sent`);
  }
  protectedIds.add(v.result.id.toLowerCase());
  addSecret(v.result.id, "<protected-token-id>");
  const envTokenStatus = { status: typeof v.result.status === "string" ? v.result.status : "unknown", hasExpiry: typeof v.result.expires_on === "string" && v.result.expires_on !== "" };

  // The workers.dev subdomain, read once so that it is redacted; never printed.
  const sub = await api("GET", `/accounts/${accountId}/workers/subdomain`);
  const subdomain = (sub.body as { result?: { subdomain?: unknown } } | null)?.result?.subdomain;
  if (typeof subdomain === "string" && subdomain !== "") addSecret(subdomain, "<subdomain>");

  const cfCall = (method: string, path: string, body?: unknown) => api(method as Parameters<CloudflareApi>[0], path, body);

  return {
    get protectedTokenIds() {
      return [...protectedIds];
    },
    api,
    apiFor: guarded,
    envTokenStatus,
    redact,
    addSecret,
    print,
    redactingIo<T extends { stdout(text: string): void; stderr(text: string): void }>(io: T): T {
      return { ...io, stdout: (text: string) => io.stdout(redact(text)), stderr: (text: string) => io.stderr(redact(text)) };
    },
    calls: () => {
      const t = now();
      return { pass: total, window: sent.filter((s) => s > t - windowMs).length };
    },
    stopReason: () => stopped,
    async cleanup() {
      const listed = await listTestTokens(cfCall, accountId);
      for (const token of listed) {
        if (!token.name.startsWith(WIZARD_TOKEN_PREFIX) || protectedIds.has(token.id.toLowerCase())) continue;
        const r = await api("DELETE", `/accounts/${accountId}/tokens/${token.id}`);
        print(`cleanup: deleted ${token.name}: ${r.status >= 200 && r.status < 300 ? "yes" : r.status === 404 ? "already gone" : `no (HTTP ${String(r.status)})`}`);
      }
      const remaining = (await listTestTokens(cfCall, accountId)).filter((t) => t.name.startsWith(WIZARD_TOKEN_PREFIX)).map((t) => t.name);
      print(`cleanup: ${WIZARD_TOKEN_PREFIX}* tokens still listed: ${remaining.length === 0 ? "none" : remaining.join(", ")}`);
      return remaining;
    },
  };
}
