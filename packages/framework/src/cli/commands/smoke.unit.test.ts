import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateEvidence } from "../../evidence/schema.js";
import type { GitState, WriteEvidenceInput } from "../../evidence/writer.js";
import type { SmokeConnection } from "../../testing/connect.js";
import { UsageError } from "../args.js";
import { captureIo } from "../io.test-support.js";
import {
  clearDevServer,
  deployRecordPath,
  devServerRecordPath,
  readDeployedOrigin,
  readDevServer,
  recordDeployOutput,
  recordDevServer,
  smokeCommand,
  SMOKE_GLOB,
  type SmokeDeps,
  type SmokeTestRun,
} from "./smoke.js";

const PASSING: SmokeTestRun = {
  tests: [
    { file: "tests/smoke/smoke.test.ts", name: "the app is healthy", state: "passed", errors: [] },
    { file: "tests/smoke/smoke.test.ts", name: "anyone can read the greeting", state: "passed", errors: [] },
  ],
  fileErrors: [],
};

function harness(over: Partial<SmokeDeps> & { run?: SmokeTestRun; dirty?: string[] } = {}) {
  const ran: SmokeConnection[] = [];
  const written: WriteEvidenceInput[] = [];
  const git: GitState = { commit: () => "c0ffee", changedTrackedFiles: () => over.dirty ?? [] };
  const deps: SmokeDeps = {
    devServer: () => ({ origin: "http://localhost:5179" }),
    deployedOrigin: () => "https://template-test-abc.owner-sub.workers.dev",
    appName: async () => "template",
    repo: () => ({ root: "/repo", git }),
    runTests: async (_appDir, connection) => {
      ran.push(connection);
      return over.run ?? PASSING;
    },
    writeEvidence: (input) => {
      written.push(input);
      return { recordPath: `/repo/validation/${input.record.target}/${input.record.runId}.json`, rawDir: "" };
    },
    newRunId: () => "abcdefghijklmno",
    now: () => new Date("2026-10-20T08:09:10.000Z"),
    versions: () => ({ node: "v22.22.0", "@lago-morph/prototype-framework": "0.1.0" }),
    ...over,
  };
  return { deps, ran, written, smoke: smokeCommand(deps) };
}

describe("smoke --target local (CLI-REQ-001; CLI-AC-005 local part)", () => {
  it("runs tests/smoke/** against the running dev server and exits 0 when all pass", async () => {
    const h = harness();
    const io = captureIo("/repo/apps/template");
    expect(await h.smoke(["--target", "local"], io)).toBe(0);
    expect(SMOKE_GLOB).toBe("tests/smoke/**/*.test.ts");
    expect(h.ran).toEqual([{ target: "local", stage: "local", baseUrl: "http://localhost:5179" }]);
    expect(io.out).toContain("http://localhost:5179");
    expect(io.out).toContain("2 passed, 0 failed");
  });

  it("accepts --stage local and refuses any other local stage", async () => {
    expect(await harness().smoke(["--target", "local", "--stage", "local"], captureIo())).toBe(0);
    await expect(harness().smoke(["--target", "local", "--stage", "other"], captureIo())).rejects.toThrow(UsageError);
  });

  it("prints the stage's log location for the day", async () => {
    const io = captureIo("/repo/apps/template");
    await harness().smoke(["--target", "local"], io);
    expect(io.out).toContain("log for today: .logs/2026-10-20.log (in the app directory)");
  });

  it("writes a schema-valid evidence record for the commit, with one result per smoke test", async () => {
    const h = harness();
    const io = captureIo("/repo/apps/template");
    await h.smoke(["--target", "local"], io);
    expect(h.written).toHaveLength(1);
    const input = h.written[0];
    expect(input?.root).toBe("/repo");
    const record = input?.record;
    expect(validateEvidence(JSON.parse(JSON.stringify(record)))).toEqual([]);
    expect(record).toMatchObject({
      runId: "abcdefghijklmno",
      commit: "c0ffee",
      target: "local",
      stage: "local",
      command: "smoke --target local --stage local",
      exitStatus: 0,
      results: [
        { id: "smoke: tests/smoke/smoke.test.ts > the app is healthy", status: "passed" },
        { id: "smoke: tests/smoke/smoke.test.ts > anyone can read the greeting", status: "passed" },
      ],
    });
    expect(Object.keys(input?.raw ?? {})).toEqual(["smoke.log", "tests.json"]);
    expect(input?.raw?.["smoke.log"]).toContain("2 passed, 0 failed");
    expect(io.out).toContain("evidence: validation/local/abcdefghijklmno.json");
  });

  it("a failing test exits 1 and is recorded failed with its first error line", async () => {
    const h = harness({
      run: {
        tests: [
          ...PASSING.tests,
          { file: "tests/smoke/smoke.test.ts", name: "notes", state: "failed", errors: ["expected 500 to be 201\n    at stack"] },
          { file: "tests/smoke/smoke.test.ts", name: "later", state: "skipped", errors: [] },
        ],
        fileErrors: [],
      },
    });
    const io = captureIo();
    expect(await h.smoke(["--target", "local"], io)).toBe(1);
    const results = h.written[0]?.record.results;
    expect(results?.[2]).toEqual({ id: "smoke: tests/smoke/smoke.test.ts > notes", status: "failed", detail: "expected 500 to be 201" });
    expect(results?.[3]).toEqual({ id: "smoke: tests/smoke/smoke.test.ts > later", status: "not-run", detail: "skipped" });
    expect(h.written[0]?.record.exitStatus).toBe(1);
    expect(io.err).toContain("FAILED notes: expected 500 to be 201");
    expect(io.out).toContain("2 passed, 1 failed, 1 skipped");
  });

  it("a file-level failure (e.g. connectTestStage rejected in beforeAll) exits 1 and is recorded", async () => {
    const h = harness({
      run: { tests: [], fileErrors: [{ file: "tests/smoke/smoke.test.ts", message: "connecting to the local dev server: GET /api/auth/me answered HTTP 500, error code CORE.INTERNAL, requestId r1" }] },
    });
    const io = captureIo();
    expect(await h.smoke(["--target", "local"], io)).toBe(1);
    expect(h.written[0]?.record.results).toEqual([
      { id: "smoke: tests/smoke/smoke.test.ts", status: "failed", detail: "connecting to the local dev server: GET /api/auth/me answered HTTP 500, error code CORE.INTERNAL, requestId r1" },
    ]);
    expect(io.err).toContain("requestId r1");
  });

  it("no smoke test at all fails (and is still recorded)", async () => {
    const h = harness({ run: { tests: [], fileErrors: [] } });
    const io = captureIo();
    expect(await h.smoke(["--target", "local"], io)).toBe(1);
    expect(io.err).toContain(`no smoke test ran (${SMOKE_GLOB})`);
    expect(h.written[0]?.record.exitStatus).toBe(1);
  });

  it("a test runner error fails with its message", async () => {
    const h = harness({ run: { tests: PASSING.tests, fileErrors: [], error: "vitest crashed" } });
    const io = captureIo();
    expect(await h.smoke(["--target", "local"], io)).toBe(1);
    expect(io.err).toContain("vitest crashed");
  });

  it("with no recorded dev server it fails before running anything, saying to start dev", async () => {
    const h = harness({ devServer: () => undefined });
    const io = captureIo();
    expect(await h.smoke(["--target", "local"], io)).toBe(1);
    expect(io.err).toMatch(/no running `dev` server.*npm run dev/);
    expect(h.ran).toEqual([]);
    expect(h.written).toEqual([]);
  });

  it("refuses a working tree with changed tracked files before running, since evidence names a commit", async () => {
    const h = harness({ dirty: ["src/app.ts"] });
    const io = captureIo();
    expect(await h.smoke(["--target", "local"], io)).toBe(1);
    expect(io.err).toMatch(/src\/app\.ts.*commit/is);
    expect(h.ran).toEqual([]);
  });

  it("a failure to write evidence fails the run even when the tests passed", async () => {
    const h = harness({
      writeEvidence: () => {
        throw new Error("disk full");
      },
    });
    const io = captureIo();
    expect(await h.smoke(["--target", "local"], io)).toBe(1);
    expect(io.err).toContain("writing the evidence record failed: disk full");
  });

  it("usage errors: missing or unknown target, unexpected argument", async () => {
    await expect(harness().smoke([], captureIo())).rejects.toThrow(/--target is missing/);
    await expect(harness().smoke(["--target", "gcp"], captureIo())).rejects.toThrow(/--target must be one of/);
    await expect(harness().smoke(["--target", "local", "secretvalue"], captureIo())).rejects.toThrow(UsageError);
  });
});

describe("smoke --target aws --stage test-… (G-11; CLI-AC-005 AWS part, offline)", () => {
  const CLOUDFRONT = "https://d1234abcd.cloudfront.net";
  const ACCOUNT_ID = "123456789012";
  const aws = (over: Partial<SmokeDeps> = {}) =>
    harness({ deployedOrigin: () => CLOUDFRONT, awsLogAccount: async () => ({ accountId: ACCOUNT_ID, region: "eu-west-1" }), ...over });

  it("runs against the recorded CloudFront origin and prints the S3 prefix (LOG-REQ-004) and the CloudWatch log group", async () => {
    const h = aws();
    const io = captureIo("/repo/apps/template");
    expect(await h.smoke(["--target", "aws", "--stage", "test-abc"], io)).toBe(0);
    expect(h.ran).toEqual([{ target: "aws", stage: "test-abc", baseUrl: CLOUDFRONT }]);
    expect(io.out).toContain(
      `log for today: S3 bucket prototype-logs-${ACCOUNT_ID} (eu-west-1), keys under template/test-abc/2026/10/20/ (s3://prototype-logs-${ACCOUNT_ID}/template/test-abc/2026/10/20/); Lambda output: CloudWatch log group /aws/lambda/template-test-abc-http (eu-west-1)`,
    );
    expect(io.out).toContain("evidence: validation/aws/abcdefghijklmno.json");
  });

  it("the evidence record redacts the account ID (the log line is in the raw smoke log)", async () => {
    const h = aws();
    await h.smoke(["--target", "aws", "--stage", "test-abc"], captureIo());
    const input = h.written[0];
    expect(input?.record).toMatchObject({ target: "aws", stage: "test-abc", command: "smoke --target aws --stage test-abc", exitStatus: 0 });
    expect(input?.raw?.["smoke.log"]).toContain(`prototype-logs-${ACCOUNT_ID}`);
    expect(input?.redactions).toEqual([{ value: ACCOUNT_ID, replacement: "<account-id>" }]);
  });

  it("when the account cannot be read, prints the location with <account-id> and the reason, and the run still counts", async () => {
    const h = aws({
      awsLogAccount: async () => {
        throw new Error("AWS credentials are not usable: STS GetCallerIdentity failed with ExpiredToken (HTTP 403)");
      },
    });
    const io = captureIo();
    expect(await h.smoke(["--target", "aws", "--stage", "test-abc"], io)).toBe(0);
    expect(io.out).toContain(
      "log for today: S3 bucket prototype-logs-<account-id>, keys under template/test-abc/2026/10/20/; Lambda output: CloudWatch log group /aws/lambda/template-test-abc-http (the account ID and region could not be read: AWS credentials are not usable: STS GetCallerIdentity failed with ExpiredToken (HTTP 403))",
    );
    expect(h.written[0]?.redactions).toEqual([]);
  });

  it("refuses production stages and reports a stage that was never deployed, before any test runs", async () => {
    const prod = aws();
    const io = captureIo();
    expect(await prod.smoke(["--target", "aws", "--stage", "prod"], io)).toBe(1);
    expect(io.err).toContain("runs only against test stages");
    const never = aws({ deployedOrigin: () => undefined });
    const io2 = captureIo();
    expect(await never.smoke(["--target", "aws", "--stage", "test-abc"], io2)).toBe(1);
    expect(io2.err).toContain("npm run deploy -- --target aws --stage test-abc");
    expect([...prod.ran, ...never.ran]).toEqual([]);
  });
});

describe("smoke --target cloudflare --stage test-… (written now, exercised in phase D)", () => {
  it("needs --stage", async () => {
    await expect(harness().smoke(["--target", "cloudflare"], captureIo())).rejects.toThrow(/--stage is missing/);
  });

  it("refuses a stage that is not a test stage, before anything else", async () => {
    const h = harness();
    const io = captureIo();
    expect(await h.smoke(["--target", "cloudflare", "--stage", "prodcheck"], io)).toBe(1);
    expect(io.err).toMatch(/only against test stages.*test-/);
    expect(h.ran).toEqual([]);
  });

  it("uses the stage's recorded deploy output and prints the log bucket location for the day", async () => {
    const h = harness();
    const io = captureIo();
    expect(await h.smoke(["--target", "cloudflare", "--stage", "test-abc"], io)).toBe(0);
    expect(h.ran).toEqual([{ target: "cloudflare", stage: "test-abc", baseUrl: "https://template-test-abc.owner-sub.workers.dev" }]);
    expect(io.out).toContain("log for today: R2 bucket prototype-logs, keys under template/test-abc/2026/10/20/");
  });

  it("redacts the account's workers.dev subdomain in the evidence (DEC-0086)", async () => {
    const h = harness();
    await h.smoke(["--target", "cloudflare", "--stage", "test-abc"], captureIo());
    expect(h.written[0]?.redactions).toEqual([{ value: "owner-sub", replacement: "<account-subdomain>" }]);
    expect(h.written[0]?.record).toMatchObject({ target: "cloudflare", stage: "test-abc", command: "smoke --target cloudflare --stage test-abc" });
  });

  it("with no recorded deploy output it fails, saying to deploy first", async () => {
    const h = harness({ deployedOrigin: () => undefined });
    const io = captureIo();
    expect(await h.smoke(["--target", "cloudflare", "--stage", "test-abc"], io)).toBe(1);
    expect(io.err).toContain("npm run deploy -- --target cloudflare --stage test-abc");
    expect(h.ran).toEqual([]);
  });
});

describe("recorded dev server and deploy output", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("dev's record round-trips; a record of a stopped process reads as none; clearing removes it", () => {
    dir = mkdtempSync(join(tmpdir(), "smoke-unit-"));
    expect(readDevServer(dir)).toBeUndefined();
    recordDevServer(dir, "http://localhost:5179");
    expect(devServerRecordPath(dir)).toBe(join(dir, ".framework", "local", "dev-server.json"));
    expect(readDevServer(dir)).toEqual({ origin: "http://localhost:5179" });
    writeFileSync(devServerRecordPath(dir), JSON.stringify({ origin: "http://localhost:1", pid: 2 ** 22 + 12345 }));
    expect(readDevServer(dir)).toBeUndefined();
    recordDevServer(dir, "http://localhost:5179");
    clearDevServer(dir);
    expect(readDevServer(dir)).toBeUndefined();
    clearDevServer(dir);
  });

  it("a malformed dev record reads as none", () => {
    dir = mkdtempSync(join(tmpdir(), "smoke-unit-"));
    mkdirSync(join(dir, ".framework", "local"), { recursive: true });
    writeFileSync(devServerRecordPath(dir), "{");
    expect(readDevServer(dir)).toBeUndefined();
  });

  it("deploy output round-trips per target and stage", () => {
    dir = mkdtempSync(join(tmpdir(), "smoke-unit-"));
    expect(readDeployedOrigin(dir, "cloudflare", "test-abc")).toBeUndefined();
    recordDeployOutput(dir, "cloudflare", "test-abc", "https://w.sub.workers.dev");
    expect(deployRecordPath(dir, "cloudflare", "test-abc")).toBe(join(dir, ".framework", "cloudflare", "stages", "test-abc.json"));
    expect(JSON.parse(readFileSync(deployRecordPath(dir, "cloudflare", "test-abc"), "utf8"))).toEqual({ publicOrigin: "https://w.sub.workers.dev" });
    expect(readDeployedOrigin(dir, "cloudflare", "test-abc")).toBe("https://w.sub.workers.dev");
    expect(readDeployedOrigin(dir, "cloudflare", "test-other")).toBeUndefined();
  });
});
