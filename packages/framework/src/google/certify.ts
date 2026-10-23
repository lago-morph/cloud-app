/**
 * Guided certification of the Google login (GOOGLE-REQ-005, google.md §2 "Certification
 * procedure"). A library with injectable I/O: the CLI's `certify-auth` supplies the terminal,
 * the clock and the evidence writer; unit tests supply stubs, so nothing contacts Google.
 */
import { FrameworkError } from "../core/errors.js";
import { GOOGLE_SCOPE } from "./provider.js";

/** One record of docs/contracts/schemas/evidence.schema.json (owner: COMPL). */
export interface EvidenceRecord {
  readonly runId: string;
  readonly commit: string;
  readonly target: "local" | "cloudflare" | "aws";
  readonly stage?: string;
  readonly command: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly exitStatus: number;
  readonly results: readonly EvidenceResult[];
  readonly versions: Readonly<Record<string, string>>;
  readonly leftovers?: readonly string[];
}

export interface EvidenceResult {
  readonly id: string;
  readonly status: "passed" | "failed" | "blocked" | "not-run";
  readonly detail?: string;
}

export interface CertifyOptions {
  readonly target: EvidenceRecord["target"];
  /** A production stage (not `test-…`): only those use Google. */
  readonly stage: string;
  /** The stage's public origin, from its deploy output. */
  readonly origin: string;
  /** The stage's `framework.google.clientId`. */
  readonly clientId: string;
  readonly commit: string;
  readonly runId: string;
  readonly versions: Readonly<Record<string, string>>;
}

/** Everything the procedure does outside itself; the CLI wires a terminal, tests wire stubs. */
export interface CertifyIo {
  /** Used for the step-1 request; defaults to global `fetch`. */
  readonly fetch?: typeof fetch;
  print(text: string): void;
  /** Shows `question` and resolves to what the owner pasted. */
  ask(question: string): Promise<string>;
  /** Stores the record (COMPL's `validation/<target>/<runId>.json`) and resolves to its path. */
  writeEvidence(record: EvidenceRecord): Promise<string>;
  now(): Date;
}

export interface CertifyOutcome {
  readonly record: EvidenceRecord;
  readonly path: string;
}

/** AUTH's user ID shape: `u_` + 26 base32 characters (auth.md "User ID"; letter case not fixed). */
const USER_ID = /^u_[A-Z2-7]{26}$/i;

/** Steps 3 and 4: checks the pasted `/api/auth/me` JSON; returns the problem or null. */
function checkMe(step: number, pasted: string, expected: "user" | "anonymous"): string | null {
  let me: { level?: unknown; id?: unknown };
  try {
    me = JSON.parse(pasted) as typeof me;
  } catch {
    return `step ${step}: the pasted text is not JSON`;
  }
  if (me === null || typeof me !== "object") return `step ${step}: the pasted text is not JSON`;
  if (me.level !== expected) return `step ${step}: level is ${String(me.level)}, expected ${expected}`;
  if (expected === "user" && (typeof me.id !== "string" || !USER_ID.test(me.id))) {
    return `step ${step}: user ID ${String(me.id)} is not well-formed`;
  }
  return null;
}

/**
 * google.md §2 steps 1-5. Step 1 is GOOGLE-AC-001's cloud check; the whole run is GOOGLE-AC-005.
 * A failed step ends the procedure; the record is written either way.
 */
export async function certifyAuth(options: CertifyOptions, io: CertifyIo): Promise<CertifyOutcome> {
  if (options.stage.startsWith("test-")) {
    throw new FrameworkError(
      "CORE.MISCONFIGURED",
      `certify-auth needs a production stage; ${options.stage} is a test stage, which uses the authentication mock instead of Google`,
    );
  }
  const startedAt = io.now().toISOString();
  const origin = new URL(options.origin).origin;
  const results: EvidenceResult[] = [];

  const step1 = await checkLoginRedirect({ origin, clientId: options.clientId, ...(io.fetch ? { fetch: io.fetch } : {}) });
  let problem: string | null = null;
  if (step1.ok) {
    io.print("Step 1 passed: /api/auth/login redirects to Google with the client ID, callback URL, PKCE challenge, state and nonce.");
    results.push({ id: "GOOGLE-AC-001", status: "passed" });
    io.print(`Step 2: open ${origin}/ in a browser and log in with the dedicated test account.`);
    problem = checkMe(3, await io.ask(`Step 3: open ${origin}/api/auth/me and paste the JSON it shows:`), "user");
    if (problem === null) {
      problem = checkMe(4, await io.ask(`Step 4: log out, open ${origin}/api/auth/me again and paste the JSON it shows:`), "anonymous");
    }
  } else {
    problem = `step 1: ${step1.problems.join("; ")}`;
    results.push({ id: "GOOGLE-AC-001", status: "failed", detail: problem });
  }
  results.push(problem === null ? { id: "GOOGLE-AC-005", status: "passed" } : { id: "GOOGLE-AC-005", status: "failed", detail: problem });

  const record: EvidenceRecord = {
    runId: options.runId,
    commit: options.commit,
    target: options.target,
    stage: options.stage,
    command: `certify-auth --target ${options.target} --stage ${options.stage}`,
    startedAt,
    finishedAt: io.now().toISOString(),
    exitStatus: problem === null ? 0 : 1,
    results,
    versions: options.versions,
  };
  const path = await io.writeEvidence(record);
  io.print(problem === null ? `Certification passed. Evidence: ${path}` : `Certification failed (${problem}). Evidence: ${path}`);
  return { record, path };
}

/** Where the login must send the browser. */
export const GOOGLE_AUTHORIZATION_ORIGIN = "https://accounts.google.com";

export interface LoginRedirectCheckOptions {
  /** The deployment's public origin, e.g. `https://<worker>.workers.dev`. */
  readonly origin: string;
  /** The stage's configured `framework.google.clientId`. */
  readonly clientId: string;
  readonly fetch?: typeof fetch;
}

export interface LoginRedirectCheck {
  readonly ok: boolean;
  /** One line per failed check; empty when `ok`. */
  readonly problems: readonly string[];
}

/**
 * Step 1, also the routine production check: `/api/auth/login` redirects to Google with the
 * configured client ID and callback URL, an S256 PKCE challenge, a state and a nonce, and scope
 * exactly `openid profile`. The redirect is inspected, never followed.
 */
export async function checkLoginRedirect(options: LoginRedirectCheckOptions): Promise<LoginRedirectCheck> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const origin = new URL(options.origin).origin;
  const res = await doFetch(`${origin}/api/auth/login`, { redirect: "manual" });
  if (res.status < 300 || res.status > 399) return { ok: false, problems: [`no redirect (HTTP ${res.status})`] };
  const location = res.headers.get("location");
  if (!location) return { ok: false, problems: [`no redirect (HTTP ${res.status} without Location)`] };

  const url = new URL(location, origin);
  const p = url.searchParams;
  const callback = `${origin}/api/auth/callback`;
  const problems: string[] = [];
  if (url.origin !== GOOGLE_AUTHORIZATION_ORIGIN) problems.push(`does not redirect to ${GOOGLE_AUTHORIZATION_ORIGIN}`);
  if (p.get("response_type") !== "code") problems.push("response type is not code");
  if (p.get("client_id") !== options.clientId) problems.push(`client ID is not ${options.clientId}`);
  if (p.get("redirect_uri") !== callback) problems.push(`callback URL is not ${callback}`);
  if (p.getAll("scope").join(" ") !== GOOGLE_SCOPE) problems.push(`scope is not exactly ${GOOGLE_SCOPE}`);
  if (!p.get("code_challenge")) problems.push("no PKCE challenge (code_challenge)");
  if (p.get("code_challenge_method") !== "S256") problems.push("PKCE method is not S256");
  if (!p.get("state")) problems.push("no state");
  if (!p.get("nonce")) problems.push("no nonce");
  return { ok: problems.length === 0, problems };
}
