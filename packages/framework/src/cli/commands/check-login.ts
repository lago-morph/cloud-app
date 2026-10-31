/**
 * `check-login --target cloudflare --stage <s>` (CLI-REQ-001; plan-v0.2.0 §6.1 item 3, §7.1
 * E2E-008; DEC-0670): the automated part of the real-login check on a production stage, over
 * HTTP only. A real sign-in needs a person on Cloudflare's own login page, so it is the owner's
 * once-per-release milestone; this command checks everything up to that page.
 *
 * Inputs, none typed by anyone: the stage's public origin from its recorded deploy output
 * (`deploy`, DEC-0272), and the app's name from its definition (the app ID `<app>-<stage>`,
 * DEC-0667). It needs no Cloudflare credential: it never calls the Cloudflare API.
 *
 * The steps, stopping at the first failure (`runLoginCheck`):
 *   1. `GET /api/auth/login`, sent with a forged host, redirects (302) to an https `/start` on the
 *      auth app with exactly `app=<app>-<stage>`, `return=<public origin>/api/auth/callback` (from
 *      the deployment, not the forged host: AUTH-REQ-008) and a state, and sets `__Host-login`;
 *   2. that `/start` accepts it (302, so the return URL is registered for the app ID) and sends
 *      the browser on to an https authorization endpoint with `response_type=code`, PKCE S256 and
 *      a state, setting its own sign-in cookie. A 400 means the return URL is not registered.
 *
 * One evidence record (`src/evidence`) with results for E2E-008 (its automated part) and
 * AUTH-AC-011 (the callback URL under a forged host); PWD-AC-009 is `not-run` (retired with the
 * password provider, plan §6). Exit 0 only if every step passed. The account's `workers.dev`
 * subdomain is never recorded (DEC-0086). Test stages and target `local` are refused before any
 * request: they sign in with the authentication mock only (plan §4.3).
 */
import type { Dispatcher } from "undici";
import type { Target } from "../../core/identity.js";
import type { EvidencePaths, EvidenceResult, GitState, Redaction, WriteEvidenceInput } from "../../evidence/writer.js";
import { authAppId } from "../../targets/cloudflare/auth-app.js";
import { UsageError } from "../args.js";
import { describeFailure } from "../failure.js";
import { EXIT, type Command } from "../io.js";
import { fetchOver } from "../one-connection.js";
import { checkedStage, parseCloudTargetStage, refuseUnreachableCloud, type ProcessEnvironment } from "./smoke-cloud.js";

/** The criteria a run gives results for (`tests/compliance/harness/prodcheck.ts` folds them). */
export const CHECK_LOGIN_IDS = ["PWD-AC-009", "AUTH-AC-011", "E2E-008"] as const;

/** The host the login request claims to be sent to (a reserved name, never resolvable). */
export const FORGED_HOST = "forged-host.example.test";

export interface LoginCheckOptions {
  /** The stage's public origin. */
  readonly origin: string;
  /** The app's ID at the auth app (`<app>-<stage>`). */
  readonly appId: string;
}

export interface LoginCheckIo {
  readonly fetch: typeof fetch;
  /** One progress line. */
  print(line: string): void;
}

export interface LoginCheckOutcome {
  /** The step that failed and why, or undefined when every step passed. */
  readonly failure?: { readonly step: number; readonly problem: string };
  readonly results: readonly EvidenceResult[];
}

class StepFailure extends Error {
  constructor(
    readonly step: number,
    message: string,
  ) {
    super(message);
  }
}

const cookieNames = (response: Response): string[] => response.headers.getSetCookie().map((line) => line.split("=")[0]?.trim() ?? "");

export async function runLoginCheck(options: LoginCheckOptions, io: LoginCheckIo): Promise<LoginCheckOutcome> {
  const origin = new URL(options.origin).origin;
  let step = 0;
  const fail = (text: string): never => {
    throw new StepFailure(step, text);
  };
  const get = async (url: URL, headers: Record<string, string> = {}): Promise<Response> => {
    try {
      return await io.fetch(url, { method: "GET", headers, redirect: "manual" });
    } catch (error) {
      return fail(`GET ${url.origin}${url.pathname} could not be sent: ${describeFailure(error)}`);
    }
  };
  /** The response's `Location` as an https URL, or a failure naming what came back. */
  const redirectOf = (what: string, response: Response): URL => {
    const location = response.headers.get("location");
    if (response.status !== 302 || location === null) return fail(`${what}: expected a 302 redirect, got status ${String(response.status)}`);
    let url: URL;
    try {
      url = new URL(location);
    } catch {
      return fail(`${what}: the redirect is not an absolute URL`);
    }
    if (url.protocol !== "https:") fail(`${what}: the redirect is not https`);
    return url;
  };
  const param = (what: string, url: URL, name: string, expected?: string): string => {
    const values = url.searchParams.getAll(name);
    if (values.length !== 1 || values[0] === "") fail(`${what}: the redirect has no single ${name} parameter`);
    const value = values[0] as string;
    if (expected !== undefined && value !== expected) fail(`${what}: ${name} is ${JSON.stringify(value)}, expected ${JSON.stringify(expected)}`);
    return value;
  };

  try {
    step = 1;
    io.print("step 1: /api/auth/login redirects to the auth app's /start");
    const login = await get(new URL("/api/auth/login", origin), { "x-forwarded-host": FORGED_HOST, forwarded: `host=${FORGED_HOST};proto=https` });
    const start = redirectOf("login", login);
    if (start.pathname !== "/start") fail(`login: the redirect goes to ${start.pathname}, not the auth app's /start`);
    param("login", start, "app", options.appId);
    param("login", start, "return", `${origin}/api/auth/callback`);
    param("login", start, "state");
    if (!cookieNames(login).includes("__Host-login")) fail("login: no __Host-login transaction cookie was set");

    step = 2;
    io.print("step 2: the auth app accepts the app ID and the return URL");
    const accepted = await get(start);
    if (accepted.status === 400) fail("the auth app refused the sign-in (400): the return URL is not registered for this app ID; deploy the stage again");
    const authorize = redirectOf("auth app /start", accepted);
    param("auth app /start", authorize, "response_type", "code");
    param("auth app /start", authorize, "code_challenge_method", "S256");
    param("auth app /start", authorize, "state");
    if (!cookieNames(accepted).includes("__Host-auth-signin")) fail("auth app /start: no sign-in cookie was set");
  } catch (error) {
    if (!(error instanceof StepFailure)) throw error;
    const problem = `step ${String(error.step)}: ${error.message}`;
    const results: EvidenceResult[] = [
      retired(),
      // AUTH-AC-011 is the callback URL check of step 1.
      error.step === 1 ? { id: "AUTH-AC-011", status: "failed", detail: problem } : { id: "AUTH-AC-011", status: "passed" },
      { id: "E2E-008", status: "failed", detail: problem },
    ];
    return { failure: { step: error.step, problem: error.message }, results };
  }
  return { results: [retired(), { id: "AUTH-AC-011", status: "passed" }, { id: "E2E-008", status: "passed" }] };
}

function retired(): EvidenceResult {
  return { id: "PWD-AC-009", status: "not-run", detail: "retired with the password provider (plan-v0.2.0 §6)" };
}

export interface CheckLoginDeps {
  readonly env: ProcessEnvironment;
  deployedOrigin(appDir: string, target: Target, stage: string): string | undefined;
  /** The app's name, from its definition. */
  appName(appDir: string): Promise<string>;
  repo(appDir: string): { readonly root: string; readonly git: GitState };
  readonly fetch: typeof fetch;
  /** The one-connection dispatcher (PAR-330) every request to the stage is sent over. */
  readonly dispatcher: Dispatcher;
  writeEvidence(input: WriteEvidenceInput): EvidencePaths;
  newRunId(): string;
  now(): Date;
  versions(): Record<string, string>;
}

/** DEC-0086: the account's `workers.dev` subdomain never goes into evidence. */
function subdomainRedactions(origin: string): Redaction[] {
  const match = /^https:\/\/[^./]+\.([^./]+)\.workers\.dev(?:[/:]|$)/.exec(origin);
  return match?.[1] === undefined ? [] : [{ value: match[1], replacement: "<account-subdomain>" }];
}

export function checkLoginCommand(deps: CheckLoginDeps): Command {
  return async (args, io) => {
    const { target, stage } = parseCloudTargetStage("check-login", args);
    checkedStage(stage);
    if (stage.startsWith("test-")) {
      throw new UsageError(`check-login needs a production stage; ${stage} is a test stage, which signs in with the authentication mock only`);
    }
    const fail = (text: string): number => {
      io.stderr(`check-login: ${text}\n`);
      return EXIT.failed;
    };
    const refused = refuseUnreachableCloud("check-login", deps.env, io);
    if (refused !== undefined) return refused;

    let repo: ReturnType<CheckLoginDeps["repo"]>;
    let commit: string;
    try {
      repo = deps.repo(io.cwd);
      commit = repo.git.commit();
      const changed = repo.git.changedTrackedFiles();
      if (changed.length > 0) return fail(`the evidence record names a commit, but tracked files differ from it: ${changed.join(", ")}. Commit (or undo) these changes, then run check-login again`);
    } catch (error) {
      return fail(`the evidence record names a commit, so the app must be in a git repository with at least one commit (${describeFailure(error)})`);
    }
    const origin = deps.deployedOrigin(io.cwd, target, stage);
    if (origin === undefined) return fail(`no recorded deploy output for stage ${stage} on ${target}: deploy it first with \`npm run deploy -- --target ${target} --stage ${stage}\``);
    let app: string;
    try {
      app = await deps.appName(io.cwd);
    } catch (error) {
      return fail(`reading the app definition failed: ${describeFailure(error)}`);
    }

    const startedAt = deps.now().toISOString();
    const runId = deps.newRunId();
    io.stdout(`check-login: run ${runId} on ${stage}\n`);
    const outcome = await runLoginCheck({ origin, appId: authAppId({ app, stage }) }, { fetch: fetchOver(deps.dispatcher, deps.fetch), print: (line) => io.stdout(`${line}\n`) });
    const exitStatus = outcome.failure === undefined ? 0 : 1;
    const record = {
      runId,
      commit,
      target,
      stage,
      command: `check-login --target ${target} --stage ${stage}`,
      startedAt,
      finishedAt: deps.now().toISOString(),
      exitStatus,
      results: outcome.results,
      versions: deps.versions(),
    };
    let recordPath: string;
    try {
      recordPath = deps.writeEvidence({ root: repo.root, git: repo.git, record, redactions: subdomainRedactions(origin) }).recordPath;
    } catch (error) {
      return fail(`writing the evidence record failed: ${describeFailure(error)}`);
    }
    if (outcome.failure === undefined) io.stdout(`check-login passed: every step passed. Evidence: ${recordPath}\n`);
    else io.stderr(`check-login failed at step ${String(outcome.failure.step)}: ${outcome.failure.problem}. Evidence: ${recordPath}\n`);
    return exitStatus === 0 ? EXIT.ok : EXIT.failed;
  };
}

/** `check-login` bound to the recorded deploy output, the app definition, git and the evidence writer. */
export async function checkLoginBinding(env: ProcessEnvironment = process.env, fetchImpl?: typeof fetch): Promise<Command> {
  const [evidence, { readDeployedOrigin }, { execFileSync }, { readFileSync }, { loadApp }, { oneConnectionDispatcher }] = await Promise.all([
    import("../../evidence/public.js"),
    import("./smoke.js"),
    import("node:child_process"),
    import("node:fs"),
    import("../../build/load.js"),
    import("../one-connection.js"),
  ]);
  const frameworkVersion = (): string | undefined => {
    try {
      return (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version?: string }).version;
    } catch {
      return undefined;
    }
  };
  return checkLoginCommand({
    env,
    deployedOrigin: readDeployedOrigin,
    appName: async (appDir) => (await loadApp(appDir)).definition.name,
    repo: (appDir) => {
      const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: appDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      return { root, git: evidence.gitState(root) };
    },
    fetch: fetchImpl ?? globalThis.fetch,
    // One connection per origin, as for the other cloud commands (PAR-330, DEC-0561).
    dispatcher: oneConnectionDispatcher(env),
    writeEvidence: evidence.writeEvidence,
    newRunId: () => evidence.newRunId(),
    now: () => new Date(),
    versions: () => {
      const version = frameworkVersion();
      return { node: process.version, ...(version === undefined ? {} : { "@lago-morph/prototype-framework": version }) };
    },
  });
}
