/**
 * `check-login` (CLI-REQ-001; password.md §2 "Real-provider check"; cli.md §2; DEC-0512,
 * DEC-0527). Offline: the account settings record and the mail sink are the in-memory Cloudflare
 * account (fake-cloud), the sink's objects are written by the sink Worker's own source, the stage
 * is a fake production deployment of the password provider's endpoints, and the role change is
 * the `admins` code (`changeAdminRole`) on that stage's accounts. Each step's failure is injected
 * and its message checked; no output or record carries the address, a password or a token.
 */
import { Agent, EnvHttpProxyAgent } from "undici";
import { describe, expect, it } from "vitest";
import type { EvidenceRecord, WriteEvidenceInput } from "../../evidence/writer.js";
import { RATE_LIMITS } from "../../auth/password/options.js";
import { MAIL_SINK_BINDING, MAIL_SINK_SOURCE } from "../../mail/sink-worker.js";
import { sinkAddress } from "../../provision/cloudflare/email.js";
import { describeDelivery, lastDeliveryEvent } from "../../provision/cloudflare/email-delivery.js";
import { ACCOUNT, FakeCloud } from "../../provision/cloudflare/fake-cloud.test-support.js";
import { latestSinkMail, sinkKeys } from "../../provision/cloudflare/mail-sink.js";
import { readAccountSettings } from "../../provision/cloudflare/account-settings.js";
import { UsageError } from "../args.js";
import { captureIo } from "../io.test-support.js";
import { changeAdminRole, type AccountsDatabase } from "./admins.js";
import { oneConnectionDispatcher } from "../one-connection.js";
import { checkLoginCommand, FORGED_HOST, NO_MAIL_SETTLE_MS, SIGN_IN_LIMIT, SINK_WAIT_MS, type CheckLoginDeps } from "./check-login.js";

const ORIGIN = "https://reference-prodcheck.owner-sub.workers.dev";
const RUN_ID = "abcdefghij12345";
const PASSWORDS = ["FirstPassword0123456789A", "SecondPassword987654321B"];

type Fault =
  | "sign-up-fails"
  | "refused-sign-in-allowed"
  | "refused-sign-in-mails"
  | "no-verification-mail"
  | "link-on-forged-host"
  | "bogus-token-accepted"
  | "bogus-sets-cookie"
  | "verify-fails"
  | "level-wrong"
  | "grant-ignored"
  | "revoke-ignored"
  | "admin-not-shown"
  | "no-reset-mail"
  | "old-password-works"
  | "no-rate-limit";

interface Account {
  id: string;
  email: string;
  password: string;
  verified: boolean;
  role: string | null;
}

/** Runs the uploaded sink source on a message and stores what it writes in the fake account's bucket. */
async function deliver(cloud: FakeCloud, to: string, subject: string, link: string): Promise<void> {
  const sink = new Function(MAIL_SINK_SOURCE.replace("export default", "return"))() as { email(m: unknown, env: unknown): Promise<void> };
  const raw = [`From: Reference <no-reply@example.test>`, `To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", `Open ${link}`, ""].join("\r\n");
  const bucket = { put: async (key: string, body: ArrayBuffer) => cloud.putObject("prototype-mailsink", key, new TextDecoder().decode(body)) };
  await sink.email({ to, raw: new Blob([raw]).stream() }, { [MAIL_SINK_BINDING]: bucket });
  await new Promise((r) => setTimeout(r, 2));
}

/** A fake production deployment of the password provider (auth-password.openapi.yaml), with one fault. */
function fakeStage(cloud: FakeCloud, fault?: Fault) {
  const accounts = new Map<string, Account>();
  const tokens = new Map<string, { kind: "verify" | "reset"; email: string }>();
  const sessions = new Map<string, string>();
  const seen: { headers: Headers; path: string; dispatcher: unknown }[] = [];
  let signIns = 0;
  let next = 1;
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const error = (status: number, code: string) => json(status, { error: { code, message: "m", requestId: `req-${String(next++)}` } });
  const mailLink = (kind: "verify" | "reset", email: string): string => {
    const token = `tok-${kind}-${String(next++)}-Zx9Qw8Er7Ty6`;
    tokens.set(token, { kind, email });
    const origin = kind === "verify" && fault === "link-on-forged-host" ? `https://${FORGED_HOST}` : ORIGIN;
    return `${origin}/api/auth/${kind}?token=${token}`;
  };
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    seen.push({ headers, path: url.pathname, dispatcher: (init as { dispatcher?: unknown } | undefined)?.dispatcher });
    const body = (init?.body === undefined ? {} : JSON.parse(String(init.body))) as Record<string, string>;
    const sessionId = /__Host-session=([^;]+)/.exec(headers.get("cookie") ?? "")?.[1];
    if (init?.method === "POST" && headers.get("origin") !== ORIGIN) return error(403, "AUTH.REQUEST_FORGERY");
    switch (url.pathname) {
      case "/api/auth/password/sign-up": {
        if (fault === "sign-up-fails") return error(500, "CORE.INTERNAL");
        const id = `sub-${String(next++)}`;
        accounts.set(body.email ?? "", { id, email: body.email ?? "", password: body.password ?? "", verified: false, role: null });
        if (fault !== "no-verification-mail") await deliver(cloud, body.email ?? "", "Confirm your email address", mailLink("verify", body.email ?? ""));
        return json(200, { result: "check-email" });
      }
      case "/api/auth/password/sign-in": {
        signIns++;
        if (fault !== "no-rate-limit" && signIns > RATE_LIMITS.signIn.max) return error(429, "AUTH.RATE_LIMITED");
        const a = accounts.get(body.email ?? "");
        if (a === undefined || a.password !== body.password) {
          if (!(fault === "old-password-works" && body.password === PASSWORDS[0])) return error(400, "AUTH.LOGIN_FAILED");
        }
        if (!a!.verified && fault !== "refused-sign-in-allowed") {
          if (fault === "refused-sign-in-mails") await deliver(cloud, a!.email, "Confirm your email address", mailLink("verify", a!.email));
          return error(403, "AUTH.NOT_VERIFIED");
        }
        const sid = `s${String(next++)}`;
        sessions.set(sid, a!.email);
        return json(200, { result: "signed-in", returnTo: "/" }, { "set-cookie": `__Host-session=${sid}; Path=/; HttpOnly; Secure` });
      }
      case "/api/auth/password/verify": {
        const t = tokens.get(body.token ?? "");
        if ((t === undefined || t.kind !== "verify") && fault !== "bogus-token-accepted") {
          return fault === "bogus-sets-cookie" ? json(400, { error: { code: "AUTH.LOGIN_FAILED", message: "m", requestId: "r" } }, { "set-cookie": "x=1" }) : error(400, "AUTH.LOGIN_FAILED");
        }
        if (fault === "verify-fails") return error(400, "AUTH.LOGIN_FAILED");
        if (t !== undefined) accounts.get(t.email)!.verified = true;
        return json(200, { result: "verified" });
      }
      case "/api/auth/password/forgot": {
        if (accounts.has(body.email ?? "") && fault !== "no-reset-mail") await deliver(cloud, body.email ?? "", "Reset your password", mailLink("reset", body.email ?? ""));
        return json(200, { result: "check-email" });
      }
      case "/api/auth/password/reset": {
        const t = tokens.get(body.token ?? "");
        if (t === undefined || t.kind !== "reset") return error(400, "AUTH.LOGIN_FAILED");
        tokens.delete(body.token ?? "");
        accounts.get(t.email)!.password = body.password ?? "";
        return json(200, { result: "password-reset" });
      }
      case "/api/auth/logout":
        return new Response(null, { status: 204, headers: { "set-cookie": "__Host-session=; Path=/; Max-Age=0; HttpOnly; Secure" } });
      case "/api/auth/me": {
        const email = sessionId === undefined ? undefined : sessions.get(sessionId);
        const a = email === undefined ? undefined : accounts.get(email);
        if (a === undefined) return json(200, { level: "anonymous" });
        const level = (a.role ?? "").split(",").includes("admin") && fault !== "admin-not-shown" ? "admin" : "user";
        return json(200, { level: fault === "level-wrong" ? "anonymous" : level, id: `u_${"A".repeat(26)}`, displayName: "check-login" });
      }
      default:
        return error(404, "HTTP.NOT_FOUND");
    }
  };
  /** The stage's accounts as `admins` reads and writes them (its two statements). */
  const db: AccountsDatabase = {
    async query(sql, params) {
      if (sql.startsWith("SELECT")) {
        const a = [...accounts.values()].find((x) => x.email === params[0]);
        return a === undefined ? [] : [{ id: a.id, email_verified: a.verified ? 1 : 0, role: a.role }];
      }
      const a = [...accounts.values()].find((x) => x.id === params[1]);
      const role = params[0] as string | null;
      if (a !== undefined && !(fault === "grant-ignored" && role !== null) && !(fault === "revoke-ignored" && role === null)) a.role = role;
      return [];
    },
  };
  return { fetch: fetch as typeof globalThis.fetch, db, accounts, seen };
}

function harness(options: { fault?: Fault; changed?: readonly string[]; origin?: string | null; domain?: string | null; env?: Readonly<Record<string, string>>; missing?: readonly string[] } = {}) {
  const cloud = FakeCloud.withSharedResources();
  cloud.buckets.set("prototype-mailsink", new Set());
  if (options.domain !== null) {
    cloud.putObject("sst-state", "framework/account.json", "");
    cloud.objectBodies.set("sst-state/framework/account.json", { emailDomain: options.domain ?? "example.test" });
  }
  const stage = fakeStage(cloud, options.fault);
  const records: WriteEvidenceInput[] = [];
  let clock = 0;
  const sleeps: number[] = [];
  const passwords = [...PASSWORDS];
  const dispatcher = new Agent({ connections: 1 });
  const deps: CheckLoginDeps = {
    env: options.env ?? {},
    deployedOrigin: () => (options.origin === null ? undefined : (options.origin ?? ORIGIN)),
    repo: () => ({ root: "/repo", git: { commit: () => "c0ffee", changedTrackedFiles: () => [...(options.changed ?? [])] } }),
    missingCredentials: () => options.missing ?? [],
    emailDomain: async () => (await readAccountSettings(cloud.api, ACCOUNT)).emailDomain,
    sink: { count: async (a) => (await sinkKeys(cloud.api, ACCOUNT, a)).length, latest: (a) => latestSinkMail(cloud.api, ACCOUNT, a) },
    changeRole: async (_appDir, stageName, action, address) => void (await changeAdminRole(stage.db, { action, stage: stageName }, address)),
    address: sinkAddress,
    deliveryStatus: async (domain, to, since) => describeDelivery(await lastDeliveryEvent(cloud.api, ACCOUNT, domain, to, since)),
    fetch: stage.fetch,
    dispatcher,
    writeEvidence: (input) => {
      records.push(input);
      return { recordPath: `/repo/validation/${input.record.target}/${input.record.runId}.json`, rawDir: "" };
    },
    newRunId: () => RUN_ID,
    newPassword: () => passwords.shift() ?? "x",
    now: () => new Date("2026-10-25T12:00:00Z"),
    versions: () => ({ node: "v22" }),
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    clock: () => clock,
  };
  const run = async (args = ["--target", "cloudflare", "--stage", "prodcheck"]) => {
    const io = captureIo();
    const status = await checkLoginCommand(deps)(args, io);
    return { status, io, out: io.out + io.err };
  };
  return { cloud, stage, records, run, sleeps, dispatcher, record: (): EvidenceRecord => records[0]!.record };
}

const ADDRESS = `sink+${RUN_ID}@t.example.test`;

function expectNothingSecret(text: string): void {
  for (const secret of [ADDRESS, ...PASSWORDS, "Zx9Qw8Er7Ty6", "owner-sub"]) expect(text).not.toContain(secret);
}

describe("check-login: refusals before any request", () => {
  it("refuses target local and a test stage as usage errors, an invalid stage name too", async () => {
    const h = harness();
    await expect(h.run(["--target", "local", "--stage", "local"])).rejects.toThrow(UsageError);
    await expect(h.run(["--target", "cloudflare", "--stage", "test-abc"])).rejects.toThrow(/needs a production stage; test-abc is a test stage/);
    await expect(h.run(["--target", "cloudflare", "--stage", "Bad_Stage"])).rejects.toThrow(UsageError);
    expect(h.stage.seen).toEqual([]);
    expect(h.cloud.requests).toEqual([]);
  });

  it("an unreachable process, missing credentials, a dirty tree, no deploy output or no email domain exit 1 with no stage request and no record", async () => {
    for (const [options, message] of [
      [{ env: { HTTPS_PROXY: "http://proxy.invalid:1" } }, /NODE_USE_ENV_PROXY=1/],
      [{ missing: ["CLOUDFLARE_API_TOKEN"] }, /missing Cloudflare credentials: CLOUDFLARE_API_TOKEN/],
      [{ changed: ["src/app.ts"] }, /tracked files differ from it: src\/app\.ts/],
      [{ origin: null }, /no recorded deploy output for stage prodcheck/],
      [{ domain: null }, /names no email domain; run setup-account --target cloudflare --email-domain <domain>/],
    ] as const) {
      const h = harness(options);
      const r = await h.run();
      expect(r.status, String(message)).toBe(1);
      expect(r.out).toMatch(message);
      expect(h.stage.seen).toEqual([]);
      expect(h.records).toEqual([]);
    }
  });
});

describe("check-login: the steps (password.md §2)", () => {
  it("passes every step against a working stage and writes one record with PWD-AC-009, AUTH-AC-011 and E2E-008 passed", async () => {
    const h = harness();
    const r = await h.run();
    expect(r.status, r.out).toBe(0);
    for (let step = 1; step <= 8; step++) expect(r.io.out).toContain(`step ${String(step)} passed`);
    expect(r.io.out).toMatch(/check-login passed: every step passed\. Evidence: \/repo\/validation\/cloudflare\/abcdefghij12345\.json/);
    expect(h.records).toHaveLength(1);
    const record = h.record();
    expect(record).toMatchObject({ runId: RUN_ID, commit: "c0ffee", target: "cloudflare", stage: "prodcheck", command: "check-login --target cloudflare --stage prodcheck", exitStatus: 0 });
    expect(record.results).toEqual([
      { id: "PWD-AC-009", status: "passed" },
      { id: "AUTH-AC-011", status: "passed" },
      { id: "E2E-008", status: "passed" },
    ]);
    // The sign-up address is the run's sink address, under t.<domain> (DEC-0527), with a forged host.
    expect([...h.stage.accounts.keys()]).toEqual([ADDRESS]);
    const signUp = h.stage.seen.find((s) => s.path === "/api/auth/password/sign-up");
    expect(signUp?.headers.get("x-forwarded-host")).toBe(FORGED_HOST);
    // The role is revoked: no role is left stored (DEC-0526).
    expect(h.stage.accounts.get(ADDRESS)?.role).toBeNull();
    // Every POST carried the public origin (AUTH-REQ-007).
    expect(h.stage.seen.filter((s) => s.headers.get("content-type") !== null).every((s) => s.headers.get("origin") === ORIGIN)).toBe(true);
    // The sink was read only, and waits were bounded.
    expect(h.cloud.requests.every((q) => q.startsWith("GET "))).toBe(true);
    expect(h.sleeps).toContain(NO_MAIL_SETTLE_MS);
    // The burst sent at most PAR-258 + 1 sign-ins.
    expect(SIGN_IN_LIMIT).toBe(RATE_LIMITS.signIn.max);
    expectNothingSecret(r.out);
    expectNothingSecret(JSON.stringify(record));
    // The redactions cover the values, and the account's subdomain (DEC-0086).
    const hidden = (h.records[0]!.redactions ?? []).map((x) => x.value);
    expect(hidden).toEqual(expect.arrayContaining([ADDRESS, ...PASSWORDS, "owner-sub"]));
    expect(hidden.some((v) => v.startsWith("tok-verify-")) && hidden.some((v) => v.startsWith("tok-reset-"))).toBe(true);
  });

  it("[PWD §2 step 7] sends every request to the stage over the one dispatcher, so the burst comes from one client IP", async () => {
    const h = harness();
    const r = await h.run();
    expect(r.status, r.out).toBe(0);
    expect(h.stage.seen.length).toBeGreaterThan(SIGN_IN_LIMIT + 5);
    expect(h.stage.seen.every((s) => s.dispatcher === h.dispatcher)).toBe(true);
  });

  it.each<[Fault, number, RegExp, "failed" | "passed" | "not-run"]>([
    ["sign-up-fails", 1, /sign-up with a forged host: expected 200 "check-email", got status 500 CORE\.INTERNAL \(requestId req-\d+\)/, "failed"],
    ["refused-sign-in-allowed", 2, /sign-in before verification: expected 403 AUTH\.NOT_VERIFIED, got status 200/, "failed"],
    ["refused-sign-in-mails", 2, /the refused sign-in sent mail: the sink holds 2 messages/, "failed"],
    ["no-verification-mail", 3, new RegExp(`no verification mail reached the mail sink within ${String(SINK_WAIT_MS / 1000)} s`), "failed"],
    ["link-on-forged-host", 3, /the verification mail has a link on another origin \(https:\/\/forged-host\.example\.test\), not on the stage's public origin/, "failed"],
    ["bogus-token-accepted", 3, /verify with a bogus token: expected 400 AUTH\.LOGIN_FAILED, got status 200/, "failed"],
    ["bogus-sets-cookie", 3, /verify with a bogus token set a cookie/, "failed"],
    ["verify-fails", 3, /verify with the mailed token: expected 200 "verified", got status 400 AUTH\.LOGIN_FAILED/, "passed"],
    ["level-wrong", 4, /after sign-in: \/api\/auth\/me shows level anonymous, expected user/, "passed"],
    ["grant-ignored", 5, /the next request after admins grant: \/api\/auth\/me shows level user, expected admin/, "passed"],
    ["revoke-ignored", 5, /the next request after admins revoke: \/api\/auth\/me shows level admin, expected user/, "passed"],
    ["no-reset-mail", 6, /no password reset mail reached the mail sink within/, "passed"],
    ["old-password-works", 7, /sign-in with the old password: expected 400 AUTH\.LOGIN_FAILED, got status 200/, "passed"],
    ["no-rate-limit", 8, /a burst of 6 wrong-password sign-ins got no 429 AUTH\.RATE_LIMITED \(PAR-258\)/, "passed"],
  ])("a stage with fault %s fails at step %i with its message, exit 1, and one record", async (fault, step, message, auth011) => {
    const h = harness({ fault });
    const r = await h.run();
    expect(r.status, r.out).toBe(1);
    expect(r.io.err).toMatch(new RegExp(`check-login failed at step ${String(step)}: `));
    expect(r.io.err).toMatch(message);
    expect(r.io.err).toMatch(/Evidence: \/repo\/validation\/cloudflare\/abcdefghij12345\.json/);
    // Step 2's "no mail" check completes once the verification mail of step 3 is read.
    const mailRead = !["no-verification-mail", "link-on-forged-host"].includes(fault);
    for (let s = 1; s < step; s++) if (s !== 2 || mailRead) expect(r.io.out).toContain(`step ${String(s)} passed`);
    expect(r.io.out).not.toContain(`step ${String(step)} passed`);
    const record = h.record();
    expect(record.exitStatus).toBe(1);
    const byId = Object.fromEntries(record.results.map((x) => [x.id, x]));
    expect(byId["PWD-AC-009"]).toMatchObject({ status: "failed" });
    expect(byId["PWD-AC-009"]?.detail).toMatch(new RegExp(`^step ${String(step)}: `));
    expect(byId["PWD-AC-009"]?.detail).toMatch(message);
    expect(byId["E2E-008"]).toMatchObject({ status: "failed", detail: byId["PWD-AC-009"]?.detail });
    expect(byId["AUTH-AC-011"]?.status).toBe(auth011);
    expectNothingSecret(r.out);
    expectNothingSecret(JSON.stringify(record));
  });

  it("a check that fails after the grant still revokes the role, so no admin is left behind (DEC-0526)", async () => {
    const h = harness({ fault: "admin-not-shown" });
    const r = await h.run();
    expect(r.status).toBe(1);
    expect(r.io.err).toMatch(/step 5: the next request after admins grant: \/api\/auth\/me shows level user, expected admin/);
    expect(h.stage.accounts.get(ADDRESS)?.role, "revoked after the failure").toBeNull();
  });

  it("a mail that does not arrive names Email Sending's last delivery event for the recipient (emailSendingAdaptive)", async () => {
    const h = harness({ fault: "no-verification-mail" });
    h.cloud.emailEvents.push(
      { zoneTag: h.cloud.zones.get("example.test")!.id, to: ADDRESS, datetime: "2026-10-25T12:00:03Z", status: "failed", errorCause: "routing_unknown_address", errorDetail: `550 5.1.1 <${ADDRESS}>: Address does not exist` },
      { zoneTag: h.cloud.zones.get("example.test")!.id, to: "sink+other@t.example.test", datetime: "2026-10-25T12:00:04Z", status: "delivered" },
    );
    const r = await h.run();
    expect(r.status).toBe(1);
    expect(r.io.err).toMatch(
      /step 3: no verification mail reached the mail sink within 180 s; Email Sending's last event for the recipient \(emailSendingAdaptive, 2026-10-25T12:00:03Z\): status failed, errorCause routing_unknown_address, errorDetail "550 5\.1\.1 <<test-address>>: Address does not exist"/,
    );
    expect(h.record().results[0]?.detail).toMatch(/errorCause routing_unknown_address/);
    const query = h.cloud.requests.filter((q) => q === "POST /graphql");
    expect(query).toHaveLength(1);
    expectNothingSecret(r.out);
    expectNothingSecret(JSON.stringify(h.record()));
  });

  it("with no delivery event yet, or a failing analytics query, the timeout says so", async () => {
    const none = harness({ fault: "no-reset-mail" });
    const a = await none.run();
    expect(a.io.err).toMatch(/step 6: no password reset mail reached the mail sink within 180 s; Email Sending has recorded no delivery event for the recipient yet \(emailSendingAdaptive lags by over a minute\)/);
    const failing = harness({ fault: "no-verification-mail" });
    failing.cloud.graphqlErrors = [{ message: "not authorized for that dataset" }];
    const b = await failing.run();
    expect(b.io.err).toMatch(/within 180 s; the delivery status could not be read \(the Email Sending analytics query failed: not authorized for that dataset\)/);
  });
});

describe("check-login: one connection (PAR-330)", () => {
  it("is one connection per origin, through the environment's proxy when one is set", () => {
    const direct = oneConnectionDispatcher({});
    expect(direct).toBeInstanceOf(Agent);
    expect(direct).not.toBeInstanceOf(EnvHttpProxyAgent);
    expect(oneConnectionDispatcher({ HTTPS_PROXY: "http://proxy.invalid:3128", NODE_USE_ENV_PROXY: "1" })).toBeInstanceOf(EnvHttpProxyAgent);
    expect(oneConnectionDispatcher({ http_proxy: "http://proxy.invalid:3128" })).toBeInstanceOf(EnvHttpProxyAgent);
  });
});
