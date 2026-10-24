import { describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import type { EvidenceRecord } from "../../evidence/writer.js";
import { UsageError } from "../args.js";
import { captureIo } from "../io.test-support.js";
import { certifyAuthCommand, readLines, type CertifyAuthDeps } from "./certify-auth.js";

const ORIGIN = "https://notes-prod.owner-sub.workers.dev";
const CLIENT_ID = "client-id-from-a-stubbed-config";

/** The Location a correct login redirect carries (hand-built; nothing contacts Google). */
function goodLocation(): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: `${ORIGIN}/api/auth/callback`,
    scope: "openid profile",
    code_challenge: "abc",
    code_challenge_method: "S256",
    state: "st",
    nonce: "no",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

function harness(options: { location?: string; origin?: string | null; clientId?: string | null; changed?: string[]; env?: Record<string, string> } = {}) {
  const requests: string[] = [];
  const records: { record: EvidenceRecord; redactions: readonly { value: string }[] }[] = [];
  const deps: CertifyAuthDeps = {
    env: options.env ?? {},
    deployedOrigin: () => (options.origin === null ? undefined : (options.origin ?? ORIGIN)),
    googleClientId: async () => (options.clientId === null ? undefined : (options.clientId ?? CLIENT_ID)),
    repo: () => ({ root: "/repo", git: { commit: () => "c0ffee", changedTrackedFiles: () => options.changed ?? [] } }),
    fetch: async (input) => {
      requests.push(String(input));
      return new Response(null, { status: 302, headers: { location: options.location ?? goodLocation() } });
    },
    writeEvidence: (input) => {
      records.push({ record: input.record, redactions: input.redactions ?? [] });
      return { recordPath: `/repo/validation/${input.record.target}/${input.record.runId}.json`, rawDir: "" };
    },
    newRunId: () => "run1",
    now: () => new Date("2026-10-20T00:00:00Z"),
    versions: () => ({ node: "v22" }),
  };
  return { deps, requests, records };
}

const PROD = ["--target", "cloudflare", "--stage", "prod"];
const ME_USER = JSON.stringify({ level: "user", id: `u_${"A".repeat(26)}` });
const ME_ANON = JSON.stringify({ level: "anonymous" });

describe("certify-auth (CLI-REQ-001, GOOGLE-REQ-005; offline, Google mocked)", () => {
  it("refuses a test stage before any request: certification needs a production stage", async () => {
    const h = harness();
    const io = captureIo();
    expect(await certifyAuthCommand(h.deps)(["--target", "cloudflare", "--stage", "test-abc"], io)).toBe(1);
    expect(io.err).toMatch(/needs a production stage/);
    expect(h.requests).toEqual([]);
    expect(h.records).toEqual([]);
  });

  it("is refused for target local", async () => {
    await expect(certifyAuthCommand(harness().deps)(["--target", "local", "--stage", "local"], captureIo())).rejects.toThrow(UsageError);
  });

  it("needs the stage's recorded deploy output and its configured Google client ID", async () => {
    const noDeploy = harness({ origin: null });
    const a = captureIo();
    expect(await certifyAuthCommand(noDeploy.deps)(PROD, a)).toBe(1);
    expect(a.err).toMatch(/deploy it first/);
    const noClient = harness({ clientId: null });
    const b = captureIo();
    expect(await certifyAuthCommand(noClient.deps)(PROD, b)).toBe(1);
    expect(b.err).toContain("framework.google.clientId");
    expect([...noDeploy.requests, ...noClient.requests]).toEqual([]);
  });

  it("refuses when tracked files differ from HEAD, since the record names a commit", async () => {
    const h = harness({ changed: ["src/app.ts"] });
    const io = captureIo();
    expect(await certifyAuthCommand(h.deps)(PROD, io)).toBe(1);
    expect(io.err).toContain("src/app.ts");
    expect(h.requests).toEqual([]);
  });

  it(tag("GOOGLE-AC-001", "local part: certify-auth runs step 1 against the recorded origin (stubbed fetch) and writes its evidence record"), async () => {
    const h = harness();
    const io = captureIo("/apps/notes", [`${ME_USER}\n${ME_ANON}\n`]);
    expect(await certifyAuthCommand(h.deps)(PROD, io)).toBe(0);
    expect(h.requests).toEqual([`${ORIGIN}/api/auth/login`]);
    expect(io.out).toContain("Step 1 passed");
    const [written] = h.records;
    expect(written?.record.results).toEqual([
      { id: "GOOGLE-AC-001", status: "passed" },
      { id: "GOOGLE-AC-005", status: "passed" },
    ]);
    expect(written?.record.commit).toBe("c0ffee");
    expect(written?.redactions.map((r) => r.value)).toEqual(["owner-sub"]);
  });

  it("a failing step 1 exits 1 and still writes the record", async () => {
    const h = harness({ location: "https://evil.example/" });
    const io = captureIo();
    expect(await certifyAuthCommand(h.deps)(PROD, io)).toBe(1);
    expect(h.records[0]?.record.results[0]).toMatchObject({ id: "GOOGLE-AC-001", status: "failed" });
  });

  it("stops with status 1 when the process cannot use the proxy", async () => {
    const h = harness({ env: { HTTPS_PROXY: "http://p:1" } });
    const io = captureIo();
    expect(await certifyAuthCommand(h.deps)(PROD, io)).toBe(1);
    expect(io.err).toContain("NODE_USE_ENV_PROXY=1");
    expect(h.requests).toEqual([]);
  });

  it("reads pasted answers line by line across chunks", async () => {
    const next = readLines((async function* () {
      yield "ab";
      yield "c\nde";
      yield new TextEncoder().encode("f\r\n");
    })());
    expect(await next()).toBe("abc");
    expect(await next()).toBe("def");
    expect(await next()).toBe("");
  });
});
