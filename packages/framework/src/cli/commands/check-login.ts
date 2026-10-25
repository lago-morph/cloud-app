/**
 * `check-login --target cloudflare --stage <s>` (CLI-REQ-001; password.md §2 "Real-provider
 * check"; cli.md §2; DEC-0512, DEC-0514, DEC-0527): the automated check of the real login
 * provider on a production stage, over HTTP only, with real email delivery through the mail sink.
 *
 * Inputs, none typed by anyone:
 * - the base URL from the stage's recorded deploy output (`deploy`, DEC-0272);
 * - the email domain from the account settings record (DEC-0514), read on every run;
 * - the mail from the account's sink (`provision/cloudflare/mail-sink.ts`, the reader `mail last
 *   --target cloudflare` uses), polled within `SINK_WAIT_MS`;
 * - the role change through the `admins` code (`changeAdminRole`) against the stage's current D1.
 *
 * The steps, stopping at the first failure (`runLoginCheck`):
 *   1. sign up `sink+<run ID>@t.<domain>` (`sinkAddress`) with a random password, the request
 *      carrying a forged host;
 *   2. sign-in is refused with 403 `AUTH.NOT_VERIFIED`, and no mail arrives for it;
 *   3. the verification mail arrives; its links are on the public origin; a bogus token gets 400
 *      `AUTH.LOGIN_FAILED`, sets no cookie and leaves `/api/auth/me` anonymous; the real token verifies;
 *   4. sign-in works; `/api/auth/me` shows `user` and a well-formed ID;
 *   5. `admins grant` makes the next request `admin`, `admins revoke` makes it `user` again (the
 *      role is revoked before the check ends, also when it fails: DEC-0526);
 *   6. log out; forgot; the reset mail arrives; reset to a new password;
 *   7. the old password fails, the new one works;
 *   8. a burst of wrong-password sign-ins gets 429 `AUTH.RATE_LIMITED` within PAR-258 + 1 requests.
 *
 * One evidence record (`src/evidence`) with results for PWD-AC-009, AUTH-AC-011 and E2E-008;
 * exit 0 only if every step passed. The address, the passwords and the tokens are never printed
 * or recorded (they are also redacted from the record), nor is the account's `workers.dev`
 * subdomain (DEC-0086). Test stages and target `local` are refused before any request: a test
 * stage has the authentication mock and the test-mail route instead (password.md §2).
 */
import type { Target } from "../../core/identity.js";
import type { EvidencePaths, EvidenceResult, GitState, Redaction, WriteEvidenceInput } from "../../evidence/writer.js";
import type { MailMessage } from "../../mail/sender.js";
import { UsageError } from "../args.js";
import { describeFailure } from "../failure.js";
import { EXIT, type Command } from "../io.js";
import { checkedStage, parseCloudTargetStage, refuseUnreachableCloud, type ProcessEnvironment } from "./smoke-cloud.js";

/** How long a step waits for a message in the sink, and how often it looks (not a PAR: a bound on Email Routing's delivery). */
export const SINK_WAIT_MS = 180_000;
export const SINK_POLL_MS = 5_000;
/** How long step 2 waits, after the verification mail, before counting the messages again. */
export const NO_MAIL_SETTLE_MS = 10_000;
/** PAR-258's count (5 sign-ins per 60 s per IP, `RATE_LIMITS.signIn.max`); the burst sends one more. */
export const SIGN_IN_LIMIT = 5;

/** The criteria a run gives results for (password.md §2). */
export const CHECK_LOGIN_IDS = ["PWD-AC-009", "AUTH-AC-011", "E2E-008"] as const;

/** AUTH's user ID shape (auth.md "User ID"; letter case not fixed). */
const USER_ID = /^u_[A-Z2-7]{26}$/i;
/** The host the sign-up claims to be sent to (a reserved name, never resolvable). */
export const FORGED_HOST = "forged-host.example.test";

/** The mail sink as the check reads it: by recipient. */
export interface LoginCheckSink {
  /** The number of messages the sink holds for `address`. */
  count(address: string): Promise<number>;
  /** The latest message to `address`, or undefined. */
  latest(address: string): Promise<MailMessage | undefined>;
}

export interface LoginCheckOptions {
  /** The stage's public origin. */
  readonly origin: string;
  /** `sink+<run ID>@t.<domain>`. */
  readonly address: string;
  readonly password: string;
  readonly newPassword: string;
}

export interface LoginCheckIo {
  readonly fetch: typeof fetch;
  readonly sink: LoginCheckSink;
  /** `admins grant|revoke <address>` on the stage (the `admins` code, `changeAdminRole`). */
  changeRole(action: "grant" | "revoke", address: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** A monotonic clock in milliseconds, for the sink wait. */
  clock(): number;
  /** One progress line (never a value from the run). */
  print(line: string): void;
  /** Values found during the run that must never be printed or recorded (the tokens). */
  hide(value: string): void;
}

export interface LoginCheckOutcome {
  /** The step that failed and why (no address, password or token), or undefined when every step passed. */
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

interface Answer {
  readonly status: number;
  readonly body: unknown;
  readonly setCookies: readonly string[];
}

function describe(a: Answer): string {
  const error = (a.body as { error?: { code?: unknown; requestId?: unknown } } | undefined)?.error;
  const code = typeof error?.code === "string" ? ` ${error.code}` : "";
  const requestId = typeof error?.requestId === "string" && error.requestId !== "" ? ` (requestId ${error.requestId})` : "";
  return `status ${String(a.status)}${code}${requestId}`;
}

const errorCode = (a: Answer): string | undefined => {
  const code = (a.body as { error?: { code?: unknown } } | undefined)?.error?.code;
  return typeof code === "string" ? code : undefined;
};
const resultOf = (a: Answer): unknown => (a.body as { result?: unknown } | undefined)?.result;

/** Every URL in a message's text and HTML. */
function linksIn(message: MailMessage): URL[] {
  const out: URL[] = [];
  for (const raw of `${message.text}\n${message.html}`.match(/https?:\/\/[^\s"'<>()]+/g) ?? []) {
    try {
      out.push(new URL(raw.replace(/&amp;/g, "&").replace(/[.,;]+$/, "")));
    } catch {
      // not a URL
    }
  }
  return out;
}

/** The procedure (password.md §2), against injected HTTP, sink and role change. */
export async function runLoginCheck(options: LoginCheckOptions, io: LoginCheckIo): Promise<LoginCheckOutcome> {
  const origin = new URL(options.origin).origin;
  const cookies = new Map<string, string>();
  let step = 0;
  /** AUTH-AC-011's checks: the forged-host sign-up (1), the link origin and the bogus token (3). */
  let auth011: "pending" | "running" | "done" = "pending";
  let granted = false;

  const send = async (method: "GET" | "POST", path: string, body?: Record<string, string>, extra: Record<string, string> = {}): Promise<Answer> => {
    const headers: Record<string, string> = { accept: "application/json", ...extra };
    if (method === "POST") {
      headers["origin"] = origin;
      headers["content-type"] = "application/json";
    }
    if (cookies.size > 0) headers["cookie"] = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    let response: Response;
    try {
      response = await io.fetch(new URL(path, origin), { method, headers, redirect: "manual", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch (error) {
      throw new StepFailure(step, `${method} ${path} could not be sent: ${describeFailure(error)}`);
    }
    const setCookies = response.headers.getSetCookie();
    for (const raw of setCookies) {
      const [pair = ""] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const cleared = value === "" || /;\s*max-age\s*=\s*0\b/i.test(raw);
      if (cleared) cookies.delete(name);
      else cookies.set(name, value);
    }
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text === "" ? undefined : JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    return { status: response.status, body: parsed, setCookies };
  };
  const fail = (text: string): never => {
    throw new StepFailure(step, text);
  };
  const expectAnswer = (what: string, a: Answer, status: number, expected: { code?: string; result?: string } = {}): void => {
    const ok = a.status === status && (expected.code === undefined || errorCode(a) === expected.code) && (expected.result === undefined || resultOf(a) === expected.result);
    if (!ok) {
      const want = `${String(status)}${expected.code === undefined ? "" : ` ${expected.code}`}${expected.result === undefined ? "" : ` "${expected.result}"`}`;
      fail(`${what}: expected ${want}, got ${describe(a)}${expected.result !== undefined && a.status === status ? ` with result ${JSON.stringify(resultOf(a))}` : ""}`);
    }
  };
  const me = async (what: string): Promise<{ level?: unknown; id?: unknown }> => {
    const a = await send("GET", "/api/auth/me");
    expectAnswer(`${what}: GET /api/auth/me`, a, 200);
    return (a.body ?? {}) as { level?: unknown; id?: unknown };
  };
  const expectLevel = async (what: string, level: string, id?: string): Promise<string> => {
    const who = await me(what);
    if (who.level !== level) fail(`${what}: /api/auth/me shows level ${String(who.level)}, expected ${level}`);
    if (level === "anonymous") return "";
    if (typeof who.id !== "string" || !USER_ID.test(who.id)) fail(`${what}: /api/auth/me shows no well-formed user ID`);
    if (id !== undefined && who.id !== id) fail(`${what}: /api/auth/me shows another user ID than before`);
    return who.id as string;
  };
  /** Waits (bounded) until the sink holds more than `after` messages for the address, and returns the latest. */
  const awaitMail = async (what: string, after: number): Promise<MailMessage> => {
    const deadline = io.clock() + SINK_WAIT_MS;
    for (;;) {
      let count: number;
      try {
        count = await io.sink.count(options.address);
      } catch (error) {
        return fail(`reading the mail sink failed: ${describeFailure(error)}`);
      }
      if (count > after) {
        const message = await io.sink.latest(options.address);
        if (message !== undefined) return message;
      }
      if (io.clock() >= deadline) return fail(`no ${what} mail reached the mail sink within ${String(SINK_WAIT_MS / 1000)} s`);
      await io.sleep(SINK_POLL_MS);
    }
  };
  /** The token of the message's `/api/auth/<page>?token=` link; every link must be on the public origin. */
  const tokenIn = (message: MailMessage, page: "verify" | "reset", what: string): string => {
    const links = linksIn(message);
    const foreign = links.filter((l) => l.origin !== origin);
    if (foreign.length > 0) fail(`the ${what} mail has a link on another origin (${foreign.map((l) => l.origin).join(", ")}), not on the stage's public origin`);
    const link = links.find((l) => l.pathname === `/api/auth/${page}` && (l.searchParams.get("token") ?? "") !== "");
    if (link === undefined) fail(`the ${what} mail has no /api/auth/${page}?token= link`);
    const token = link?.searchParams.get("token") ?? "";
    io.hide(token);
    return token;
  };
  const passed = (text: string): void => io.print(`step ${String(step)} passed: ${text}`);

  try {
    step = 1;
    auth011 = "running";
    expectAnswer(
      "sign-up with a forged host",
      await send("POST", "/api/auth/password/sign-up", { email: options.address, password: options.password, displayName: "check-login" }, { "x-forwarded-host": FORGED_HOST, forwarded: `host=${FORGED_HOST};proto=https` }),
      200,
      { result: "check-email" },
    );
    passed("sign-up of a fresh sink address answered check-email");

    step = 2;
    expectAnswer("sign-in before verification", await send("POST", "/api/auth/password/sign-in", { email: options.address, password: options.password }), 403, { code: "AUTH.NOT_VERIFIED" });
    if (cookies.size > 0) fail("the refused sign-in set a cookie");

    step = 3;
    const verification = await awaitMail("verification", 0);
    const verifyToken = tokenIn(verification, "verify", "verification");
    {
      step = 2;
      await io.sleep(NO_MAIL_SETTLE_MS);
      const count = await io.sink.count(options.address).catch((error: unknown) => fail(`reading the mail sink failed: ${describeFailure(error)}`));
      if (count !== 1) fail(`the refused sign-in sent mail: the sink holds ${String(count)} messages for the address, expected only the verification mail`);
      passed("sign-in before verification was refused with 403 AUTH.NOT_VERIFIED and sent no mail");
      step = 3;
    }
    const bogus = await send("POST", "/api/auth/password/verify", { token: `${verifyToken.slice(0, -4)}xxxx` });
    expectAnswer("verify with a bogus token", bogus, 400, { code: "AUTH.LOGIN_FAILED" });
    if (bogus.setCookies.length > 0) fail("verify with a bogus token set a cookie");
    await expectLevel("after the bogus token", "anonymous");
    auth011 = "done";
    const verified = await send("POST", "/api/auth/password/verify", { token: verifyToken });
    expectAnswer("verify with the mailed token", verified, 200, { result: "verified" });
    if (verified.setCookies.length > 0) fail("verify set a cookie");
    passed("the verification mail arrived with its links on the public origin; a bogus token was refused; the mailed token verified");

    step = 4;
    const signedIn = await send("POST", "/api/auth/password/sign-in", { email: options.address, password: options.password });
    expectAnswer("sign-in after verification", signedIn, 200, { result: "signed-in" });
    const id = await expectLevel("after sign-in", "user");
    passed("sign-in works and /api/auth/me shows user with a well-formed ID");

    step = 5;
    try {
      await io.changeRole("grant", options.address);
      granted = true;
    } catch (error) {
      fail(`admins grant failed: ${describeFailure(error)}`);
    }
    await expectLevel("the next request after admins grant", "admin", id);
    try {
      await io.changeRole("revoke", options.address);
      granted = false;
    } catch (error) {
      fail(`admins revoke failed: ${describeFailure(error)}`);
    }
    await expectLevel("the next request after admins revoke", "user", id);
    passed("admins grant made the next request admin, and admins revoke made it user again");

    step = 6;
    const out = await send("POST", "/api/auth/logout");
    if (out.status !== 204 && out.status !== 200) fail(`log out: expected 204, got ${describe(out)}`);
    await expectLevel("after log out", "anonymous");
    const before = await io.sink.count(options.address).catch((error: unknown) => fail(`reading the mail sink failed: ${describeFailure(error)}`));
    expectAnswer("forgot", await send("POST", "/api/auth/password/forgot", { email: options.address }), 200, { result: "check-email" });
    const resetMail = await awaitMail("password reset", before);
    const resetToken = tokenIn(resetMail, "reset", "password reset");
    expectAnswer("reset with the mailed token", await send("POST", "/api/auth/password/reset", { token: resetToken, password: options.newPassword }), 200, { result: "password-reset" });
    passed("log out, forgot, the reset mail and the reset to a new password work");

    step = 7;
    expectAnswer("sign-in with the old password", await send("POST", "/api/auth/password/sign-in", { email: options.address, password: options.password }), 400, { code: "AUTH.LOGIN_FAILED" });
    expectAnswer("sign-in with the new password", await send("POST", "/api/auth/password/sign-in", { email: options.address, password: options.newPassword }), 200, { result: "signed-in" });
    await expectLevel("after sign-in with the new password", "user", id);
    passed("the old password fails and the new one works");

    step = 8;
    let limited = false;
    for (let i = 0; i <= SIGN_IN_LIMIT && !limited; i++) {
      const a = await send("POST", "/api/auth/password/sign-in", { email: options.address, password: `${options.newPassword}-wrong` });
      if (a.status === 429) {
        expectAnswer("a sign-in of the burst", a, 429, { code: "AUTH.RATE_LIMITED" });
        limited = true;
      } else expectAnswer("a sign-in of the burst before the limit", a, 400, { code: "AUTH.LOGIN_FAILED" });
    }
    if (!limited) fail(`a burst of ${String(SIGN_IN_LIMIT + 1)} wrong-password sign-ins got no 429 AUTH.RATE_LIMITED (PAR-258)`);
    passed("a burst of wrong-password sign-ins got 429 AUTH.RATE_LIMITED");
  } catch (error) {
    if (granted) {
      try {
        await io.changeRole("revoke", options.address);
      } catch (revokeError) {
        io.print(`check-login: revoking the test account's admin role failed: ${describeFailure(revokeError)}; revoke it with admins revoke`);
      }
    }
    const failure = error instanceof StepFailure ? { step: error.step, problem: error.message } : { step, problem: `unexpected failure: ${describeFailure(error)}` };
    const detail = `step ${String(failure.step)}: ${failure.problem}`;
    const reached: EvidenceResult =
      auth011 === "done"
        ? { id: "AUTH-AC-011", status: "passed" }
        : auth011 === "running"
          ? { id: "AUTH-AC-011", status: "failed", detail }
          : { id: "AUTH-AC-011", status: "not-run", detail: `check-login stopped before its checks: ${detail}` };
    return {
      failure,
      results: [{ id: "PWD-AC-009", status: "failed", detail }, reached, { id: "E2E-008", status: "failed", detail }],
    };
  }
  return { results: CHECK_LOGIN_IDS.map((id) => ({ id, status: "passed" as const })) };
}

// ---------------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------------

export interface CheckLoginDeps {
  readonly env: ProcessEnvironment;
  deployedOrigin(appDir: string, target: Target, stage: string): string | undefined;
  repo(appDir: string): { readonly root: string; readonly git: GitState };
  /** Names of the missing Cloudflare credential variables (checked before any request). */
  missingCredentials(): readonly string[];
  /** The account settings record's `emailDomain`, if set. */
  emailDomain(): Promise<string | undefined>;
  readonly sink: LoginCheckSink;
  /** The `admins` change on the stage's current database (the app's name from its definition). */
  changeRole(appDir: string, stage: string, action: "grant" | "revoke", address: string): Promise<void>;
  /** The test address for a run ID (`sinkAddress`). */
  address(emailDomain: string, runId: string): string;
  readonly fetch: typeof fetch;
  writeEvidence(input: WriteEvidenceInput): EvidencePaths;
  newRunId(): string;
  newPassword(): string;
  now(): Date;
  versions(): Record<string, string>;
  sleep?(ms: number): Promise<void>;
  clock?(): number;
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
      throw new UsageError(`check-login needs a production stage; ${stage} is a test stage, which has the authentication mock and the test-mail route instead`);
    }
    const fail = (text: string): number => {
      io.stderr(`check-login: ${text}\n`);
      return EXIT.failed;
    };
    const refused = refuseUnreachableCloud("check-login", deps.env, io);
    if (refused !== undefined) return refused;
    const missing = deps.missingCredentials();
    if (missing.length > 0) return fail(`missing Cloudflare credentials: ${missing.join(", ")} (set them in the environment; values are never printed)`);

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
    let domain: string | undefined;
    try {
      domain = await deps.emailDomain();
    } catch (error) {
      return fail(`reading the account settings record failed: ${describeFailure(error)}`);
    }
    if (domain === undefined) return fail("the account settings record names no email domain; run setup-account --target cloudflare --email-domain <domain>");

    const startedAt = deps.now().toISOString();
    const runId = deps.newRunId();
    const address = deps.address(domain, runId);
    const password = deps.newPassword();
    const newPassword = deps.newPassword();
    const hidden: Redaction[] = [
      { value: address, replacement: "<test-address>" },
      { value: password, replacement: "<test-password>" },
      { value: newPassword, replacement: "<test-password>" },
    ];
    const scrub = (text: string): string => hidden.reduce((t, h) => (h.value === "" ? t : t.split(h.value).join(h.replacement)), text);
    io.stdout(`check-login: run ${runId} on ${stage}\n`);
    const outcome = await runLoginCheck(
      { origin, address, password, newPassword },
      {
        fetch: deps.fetch,
        sink: deps.sink,
        changeRole: (action, to) => deps.changeRole(io.cwd, stage, action, to),
        sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
        clock: deps.clock ?? (() => performance.now()),
        print: (line) => io.stdout(`${scrub(line)}\n`),
        hide: (value) => {
          if (value !== "") hidden.push({ value, replacement: "<token>" });
        },
      },
    );
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
      results: outcome.results.map((r) => (r.detail === undefined ? r : { ...r, detail: scrub(r.detail) })),
      versions: deps.versions(),
    };
    let recordPath: string;
    try {
      recordPath = deps.writeEvidence({ root: repo.root, git: repo.git, record, redactions: [...subdomainRedactions(origin), ...hidden] }).recordPath;
    } catch (error) {
      return fail(`writing the evidence record failed: ${describeFailure(error)}`);
    }
    if (outcome.failure === undefined) io.stdout(`check-login passed: every step passed. Evidence: ${recordPath}\n`);
    else io.stderr(`check-login failed at step ${String(outcome.failure.step)}: ${scrub(outcome.failure.problem)}. Evidence: ${recordPath}\n`);
    return exitStatus === 0 ? EXIT.ok : EXIT.failed;
  };
}

/** A random password of PAR-254…PAR-255 characters (24 letters and digits). */
export function randomPassword(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

/** `check-login` bound to the recorded deploy output, git, the Cloudflare API (account settings, mail sink, D1) and the evidence writer. */
export async function checkLoginBinding(env: ProcessEnvironment = process.env, fetchImpl?: typeof fetch): Promise<Command> {
  const [evidence, { readDeployedOrigin }, { execFileSync }, { readFileSync }, { createCloudflareApi }, { missingCredentials }, { readAccountSettings }, { latestSinkMail, sinkKeys }, { sinkAddress }, admins, { loadApp }] =
    await Promise.all([
      import("../../evidence/public.js"),
      import("./smoke.js"),
      import("node:child_process"),
      import("node:fs"),
      import("../../provision/cloudflare/api.js"),
      import("../../provision/cloudflare/environment.js"),
      import("../../provision/cloudflare/account-settings.js"),
      import("../../provision/cloudflare/mail-sink.js"),
      import("../../provision/cloudflare/email.js"),
      import("./admins.js"),
      import("../../build/load.js"),
    ]);
  const api = createCloudflareApi({ token: env.CLOUDFLARE_API_TOKEN ?? "", ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }) });
  const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? "";
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
    repo: (appDir) => {
      const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: appDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      return { root, git: evidence.gitState(root) };
    },
    missingCredentials: () => missingCredentials(env),
    emailDomain: async () => (await readAccountSettings(api, accountId)).emailDomain,
    sink: {
      count: async (address) => (await sinkKeys(api, accountId, address)).length,
      latest: (address) => latestSinkMail(api, accountId, address),
    },
    async changeRole(appDir, stage, action, address) {
      const opened = await admins.openCloudflareDatabase({ api, accountId, app: (await loadApp(appDir)).definition.name, stage });
      try {
        await admins.changeAdminRole(opened.db, { action, stage }, admins.normalizeAddress(address));
      } finally {
        await opened.close();
      }
    },
    address: sinkAddress,
    fetch: fetchImpl ?? globalThis.fetch,
    writeEvidence: evidence.writeEvidence,
    newRunId: () => evidence.newRunId(),
    newPassword: randomPassword,
    now: () => new Date(),
    versions: () => {
      const version = frameworkVersion();
      return { node: process.version, ...(version === undefined ? {} : { "@lago-morph/prototype-framework": version }) };
    },
  });
}
