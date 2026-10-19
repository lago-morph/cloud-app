import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { certifyAuth, checkLoginRedirect } from "./certify.js";
import type { CertifyIo, CertifyOptions, EvidenceRecord } from "./certify.js";

// Obviously fake values; nothing here contacts Google or a deployment (prompt §4).
const ORIGIN = "https://app.test.invalid";
const CLIENT_ID = "fake-client-id.test.invalid";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

function goodLocation(overrides: Record<string, string | null> = {}): string {
  const url = new URL(AUTH_ENDPOINT);
  const params: Record<string, string | null> = {
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: `${ORIGIN}/api/auth/callback`,
    scope: "openid profile",
    state: "s".repeat(43),
    nonce: "n".repeat(43),
    code_challenge: "c".repeat(43),
    code_challenge_method: "S256",
    ...overrides,
  };
  for (const [k, v] of Object.entries(params)) if (v !== null) url.searchParams.set(k, v);
  return url.href;
}

/** A deployment whose /api/auth/login answers with `location`; records requests. */
function deployment(location: string | null, status = 302) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    const headers = new Headers();
    if (location !== null) headers.set("location", location);
    return new Response(null, { status, headers });
  }) as typeof fetch;
  return { fetch: f, calls };
}

describe("certification step 1: login redirect check", () => {
  it(tag("GOOGLE-AC-001", "the step-1 check finds a PKCE challenge, state and nonce in the login redirect, without following it"), async () => {
    const d = deployment(goodLocation());
    const result = await checkLoginRedirect({ origin: ORIGIN, clientId: CLIENT_ID, fetch: d.fetch });
    expect(result).toEqual({ ok: true, problems: [] });
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]?.url).toBe(`${ORIGIN}/api/auth/login`);
    expect(d.calls[0]?.init?.redirect).toBe("manual");
  });

  const broken: ReadonlyArray<readonly [string, string | null, string]> = [
    ["no PKCE challenge", goodLocation({ code_challenge: null }), "no PKCE challenge (code_challenge)"],
    ["a plain PKCE method", goodLocation({ code_challenge_method: "plain" }), "PKCE method is not S256"],
    ["no state", goodLocation({ state: null }), "no state"],
    ["no nonce", goodLocation({ nonce: null }), "no nonce"],
    ["another client ID", goodLocation({ client_id: "other.test.invalid" }), `client ID is not ${CLIENT_ID}`],
    ["another callback URL", goodLocation({ redirect_uri: "https://evil.example/api/auth/callback" }), `callback URL is not ${ORIGIN}/api/auth/callback`],
    ["another scope", goodLocation({ scope: "openid profile email" }), "scope is not exactly openid profile"],
    ["a non-Google destination", goodLocation().replace("https://accounts.google.com", "https://evil.example"), "does not redirect to https://accounts.google.com"],
    ["no redirect at all", null, "no redirect (HTTP 302 without Location)"],
  ];
  for (const [what, location, problem] of broken) {
    it(tag("GOOGLE-AC-001", `the step-1 check reports ${what}`), async () => {
      const result = await checkLoginRedirect({ origin: ORIGIN, clientId: CLIENT_ID, fetch: deployment(location).fetch });
      expect(result.ok).toBe(false);
      expect(result.problems).toContain(problem);
    });
  }

  it("a relative or non-redirect answer never counts as Google", async () => {
    const result = await checkLoginRedirect({ origin: ORIGIN, clientId: CLIENT_ID, fetch: deployment("/somewhere").fetch });
    expect(result.problems).toContain("does not redirect to https://accounts.google.com");
  });

  it("a non-redirect status is reported with the status", async () => {
    const result = await checkLoginRedirect({ origin: ORIGIN, clientId: CLIENT_ID, fetch: deployment(null, 404).fetch });
    expect(result).toEqual({ ok: false, problems: ["no redirect (HTTP 404)"] });
  });
});

// ---- Steps 1-5 ---------------------------------------------------------------------------

const USER_ID = "u_ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function options(overrides: Partial<CertifyOptions> = {}): CertifyOptions {
  return {
    target: "cloudflare",
    stage: "prodcheck",
    origin: ORIGIN,
    clientId: CLIENT_ID,
    commit: "0123456789abcdef0123456789abcdef01234567",
    runId: "certify-test-run",
    versions: { "@lago-morph/prototype-framework": "0.1.0" },
    ...overrides,
  };
}

/** Scripted terminal: answers each question in order; records output and the written record. */
function io(answers: string[], location: string | null = goodLocation()) {
  const printed: string[] = [];
  const asked: string[] = [];
  const written: EvidenceRecord[] = [];
  let tick = 0;
  const value: CertifyIo = {
    fetch: deployment(location).fetch,
    print: (text) => printed.push(text),
    ask: async (question) => {
      asked.push(question);
      const answer = answers.shift();
      if (answer === undefined) throw new Error(`unexpected question: ${question}`);
      return answer;
    },
    writeEvidence: async (record) => {
      written.push(record);
      return `validation/${record.target}/${record.runId}.json`;
    },
    now: () => new Date(Date.UTC(2026, 9, 19, 12, 0, tick++)),
  };
  return { io: value, printed, asked, written };
}

const me = (body: unknown) => JSON.stringify(body);

describe("certification procedure", () => {
  it("runs steps 1-5 and writes a passing evidence record", async () => {
    const t = io([me({ level: "user", id: USER_ID, displayName: "Test Account" }), me({ level: "anonymous" })]);
    const outcome = await certifyAuth(options(), t.io);
    expect(t.printed.join("\n")).toContain(ORIGIN);
    expect(t.asked).toHaveLength(2);
    expect(t.written).toHaveLength(1);
    const record = t.written[0] as EvidenceRecord;
    expect(record).toEqual({
      runId: "certify-test-run",
      commit: "0123456789abcdef0123456789abcdef01234567",
      target: "cloudflare",
      stage: "prodcheck",
      command: "certify-auth --target cloudflare --stage prodcheck",
      startedAt: "2026-10-19T12:00:00.000Z",
      finishedAt: "2026-10-19T12:00:01.000Z",
      exitStatus: 0,
      results: [
        { id: "GOOGLE-AC-001", status: "passed" },
        { id: "GOOGLE-AC-005", status: "passed" },
      ],
      versions: { "@lago-morph/prototype-framework": "0.1.0" },
    });
    expect(outcome).toEqual({ record, path: "validation/cloudflare/certify-test-run.json" });
  });

  it("a failing step-1 check stops before asking anything and records both criteria failed with the problems", async () => {
    const t = io([], goodLocation({ nonce: null }));
    const { record } = await certifyAuth(options(), t.io);
    expect(t.asked).toEqual([]);
    expect(record.exitStatus).toBe(1);
    expect(record.results).toEqual([
      { id: "GOOGLE-AC-001", status: "failed", detail: "step 1: no nonce" },
      { id: "GOOGLE-AC-005", status: "failed", detail: "step 1: no nonce" },
    ]);
  });

  const step3: ReadonlyArray<readonly [string, string, string]> = [
    ["not JSON", "<html>", "step 3: the pasted text is not JSON"],
    ["level anonymous", me({ level: "anonymous" }), "step 3: level is anonymous, expected user"],
    ["a malformed ID", me({ level: "user", id: "1234567890", displayName: null }), "step 3: user ID 1234567890 is not well-formed"],
  ];
  for (const [what, answer, detail] of step3) {
    it(`step 3 fails on ${what}`, async () => {
      const t = io([answer]);
      const { record } = await certifyAuth(options(), t.io);
      expect(t.asked).toHaveLength(1);
      expect(record.results).toEqual([
        { id: "GOOGLE-AC-001", status: "passed" },
        { id: "GOOGLE-AC-005", status: "failed", detail },
      ]);
      expect(record.exitStatus).toBe(1);
    });
  }

  it("step 4 fails when the user is still logged in after logout", async () => {
    const t = io([me({ level: "user", id: USER_ID, displayName: null }), me({ level: "user", id: USER_ID, displayName: null })]);
    const { record } = await certifyAuth(options(), t.io);
    expect(record.results[1]).toEqual({ id: "GOOGLE-AC-005", status: "failed", detail: "step 4: level is user, expected anonymous" });
  });

  it("refuses a test- stage, which has the authentication mock instead of Google", async () => {
    const t = io([]);
    const err = await certifyAuth(options({ stage: "test-abc" }), t.io).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FrameworkError);
    expect((err as FrameworkError).code).toBe("CORE.MISCONFIGURED");
    expect(t.written).toEqual([]);
  });
});
