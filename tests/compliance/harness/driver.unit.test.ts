import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateEvidence, writeEvidence, type EvidenceRecord, type GitState, type WriteEvidenceInput } from "../../../packages/framework/src/evidence/public.js";
import { parseArgs } from "./args.js";
import { NOT_SELECTED, parseWhere, type CatalogueEntry } from "./catalogue.js";
import { AWS_CALLS_REPORT_PREFIX } from "./aws-usage.js";
import { runCompliance, SecretsNotSetError, SKIP_NOTES_REPORTER, type CloudStageOps, type DriverDeps, type RunCall } from "./driver.js";
import type { NotRunRule } from "./expected.js";

const entry = (id: string, where: string, source = "components/x.md"): CatalogueEntry => ({ id, where, source, applies: parseWhere(where, source) });
const CATALOGUE = [entry("KV-AC-001", "Local, cloud"), entry("KV-AC-002", "Local, cloud"), entry("CLI-AC-002", "Local"), entry("CLI-AC-001", "Local, cloud"), entry("PROV-AC-003", "Cloud (milestone)")];

/** A made-up test secret for the fakes (DEC-0277: letters and digits, at least 12). */
const SECRET = "Fk7test0secret0value0Q2w9";

const vitestReport = (tests: { title: string; status: string; message?: string }[]): string =>
  JSON.stringify({ testResults: [{ name: "/repo/tests/compliance/criteria/a.test.ts", status: "passed", assertionResults: tests.map((t) => ({ ancestorTitles: [], title: t.title, status: t.status, failureMessages: t.message === undefined ? [] : [t.message] })) }] });

interface Harness {
  readonly deps: DriverDeps;
  readonly calls: RunCall[];
  readonly written: WriteEvidenceInput[];
  readonly logs: string[];
  readonly events: string[];
  readonly pending: Map<string, Set<string>>;
}

function harness(
  options: { dirty?: string[]; vitest?: string; vitestStatus?: number; vitestOutput?: string; unitVitest?: string; catalogue?: CatalogueEntry[]; cloud?: Partial<CloudStageOps>; pending?: string[]; notRunRules?: NotRunRule[] } = {},
): Harness {
  const calls: RunCall[] = [];
  const written: WriteEvidenceInput[] = [];
  const logs: string[] = [];
  const events: string[] = [];
  const pending = new Map<string, Set<string>>([
    ["cloudflare", new Set(options.pending ?? [])],
    ["aws", new Set(options.pending ?? [])],
  ]);
  const git: GitState = { commit: () => "c0ffee", changedTrackedFiles: () => options.dirty ?? [] };
  const files = new Map<string, string>();
  const deps: DriverDeps = {
    repoRoot: "/repo",
    git,
    catalogue: () => options.catalogue ?? CATALOGUE,
    newRunId: () => "abcdefghij12345",
    newTestSecret: () => SECRET,
    now: () => new Date("2026-10-20T10:00:00.000Z"),
    versions: () => ({ "@lago-morph/prototype-framework": "0.1.0", node: "v22.22.0" }),
    tempDir: () => "/tmp/run",
    readFile: (path) => files.get(path),
    run: (call) => {
      calls.push(call);
      events.push(`run ${call.args[0] ?? call.command}`);
      const outputFile = call.args.find((a) => a.startsWith("--outputFile.json="))?.slice("--outputFile.json=".length);
      const unit = call.args.includes("vitest.unit.config.ts");
      if (call.args[0] === "vitest" && outputFile !== undefined) files.set(outputFile, unit ? (options.unitVitest ?? vitestReport([])) : (options.vitest ?? vitestReport([])));
      if (call.args[0] === "playwright") files.set("/tmp/run/playwright.json", JSON.stringify({ suites: [], errors: [] }));
      return Promise.resolve({ status: call.args[0] === "vitest" ? (options.vitestStatus ?? 0) : 0, output: `${call.args[0] ?? ""} output${call.args[0] === "vitest" ? (options.vitestOutput ?? "") : ""}` });
    },
    startLocal: () => {
      events.push("start dev");
      return Promise.resolve({ baseUrl: "http://localhost:5173", stop: () => (events.push("stop dev"), Promise.resolve("dev log")) });
    },
    cloud: () => ({
      deploy: (stage) => (events.push(`deploy ${stage}`), Promise.resolve({ baseUrl: "https://reference-test.owner-sub.workers.dev", output: "deployed" })),
      remove: (stage) => (events.push(`remove ${stage}`), Promise.resolve("removed")),
      setSecret: (stage, name) => (events.push(`secret ${name} ${stage}`), Promise.resolve(`set secret ${name} for target cloudflare as SECRET_API_KEY (a Worker secret of stage ${stage})`)),
      listStageResources: () => Promise.resolve([]),
      ...options.cloud,
    }),
    pendingStages: {
      list: (t) => [...(pending.get(t) ?? [])],
      add: (t, s) => (events.push(`pending+ ${s}`), pending.get(t)?.add(s)),
      remove: (t, s) => (events.push(`pending- ${s}`), pending.get(t)?.delete(s)),
    },
    writeEvidence: (input) => {
      const errors = validateEvidence(JSON.parse(JSON.stringify(input.record)));
      if (errors.length > 0) throw new Error(errors.join("\n"));
      written.push(input);
      return { recordPath: `/repo/validation/${input.record.target}/${input.record.runId}.json`, rawDir: "/raw" };
    },
    log: (line) => logs.push(line),
    ...(options.notRunRules === undefined ? {} : { notRunRules: options.notRunRules }),
  };
  return { deps, calls, written, logs, events, pending };
}

const recordOf = (h: Harness): EvidenceRecord => {
  const input = h.written[0];
  if (input === undefined) throw new Error("no evidence written");
  return input.record;
};

describe("[COMPL-AC-003] compliance driver records", () => {
  it("refuses to run or record from a working tree with a modified tracked file", async () => {
    const h = harness({ dirty: ["packages/framework/src/kv/public.ts"] });
    const result = await runCompliance(parseArgs(["--target", "local"]), ["--target", "local"], h.deps);
    expect(result.exitStatus).toBe(2);
    expect(h.calls).toEqual([]);
    expect(h.written).toEqual([]);
    expect(h.logs.join("\n")).toMatch(/refusing to record evidence.*packages\/framework\/src\/kv\/public\.ts/);
  });

  it("local: starts dev, runs only the expected tagged tests, and writes a schema-valid record", async () => {
    const h = harness({ vitest: vitestReport([{ title: "[KV-AC-001] put", status: "passed" }, { title: "[CLI-AC-002] verify fails", status: "failed", message: "HTTP check failed: GET /x → status 500, code CORE.INTERNAL, requestId r1 (expected status 200)" }]), vitestStatus: 1 });
    const result = await runCompliance(parseArgs(["--target", "local"]), ["--target", "local"], h.deps);
    // The framework is built before dev starts; the typecheck output is evidence for type-only assertions (B-EV F7).
    expect(h.events).toEqual(["run run", "run run", "start dev", "run vitest", "run playwright", "stop dev"]);
    expect(h.calls.filter((c) => c.command === "npm").map((c) => c.args)).toEqual([["run", "build", "-w", "packages/framework"], ["run", "typecheck"]]);
    const vitest = h.calls.find((c) => c.args[0] === "vitest");
    const pattern = vitest?.args[vitest.args.indexOf("-t") + 1] ?? "";
    expect(new RegExp(pattern).test("[KV-AC-001] x")).toBe(true);
    expect(new RegExp(pattern).test("[PROV-AC-003] x")).toBe(false);
    expect(vitest?.env.COMPLIANCE_BASE_URL).toBe("http://localhost:5173");
    expect(vitest?.env.COMPLIANCE_TARGET).toBe("local");
    expect(vitest?.env.NODE_USE_ENV_PROXY).toBeUndefined();
    const record = recordOf(h);
    expect(record).toMatchObject({ runId: "abcdefghij12345", commit: "c0ffee", target: "local", command: "npm run compliance -- --target local", exitStatus: 1 });
    expect(record.stage).toBeUndefined();
    expect(record.results).toEqual([
      { id: "CLI-AC-001", status: "not-run", detail: "no test tagged [CLI-AC-001] ran on local" },
      { id: "CLI-AC-002", status: "failed", detail: "1 of 1 tests failed: [CLI-AC-002] verify fails: HTTP check failed: GET /x → status 500, code CORE.INTERNAL, requestId r1 (expected status 200)" },
      { id: "KV-AC-001", status: "passed" },
      { id: "KV-AC-002", status: "not-run", detail: "no test tagged [KV-AC-002] ran on local" },
    ]);
    expect(Object.keys(h.written[0]?.raw ?? {}).sort()).toEqual(["build.log", "dev.log", "expected.json", "playwright.json", "playwright.log", "typecheck.log", "vitest.json", "vitest.log"]);
    expect(result.exitStatus).toBe(1);
  });

  it("a failed typecheck still runs the tests and makes the exit status non-zero; a failed build runs nothing", async () => {
    const h = harness({ vitest: vitestReport([{ title: "[KV-AC-001] put", status: "passed" }]) });
    const run = h.deps.run;
    const failing = { ...h.deps, run: (c: RunCall) => (c.args[1] === "typecheck" ? (h.calls.push(c), Promise.resolve({ status: 2, output: "error TS2322" })) : run(c)) };
    const result = await runCompliance(parseArgs(["--target", "local", "--only", "KV-AC-001"]), [], failing);
    expect(recordOf(h).results.find((r) => r.id === "KV-AC-001")).toEqual({ id: "KV-AC-001", status: "passed" });
    expect(h.written[0]?.raw?.["typecheck.log"]).toBe("error TS2322");
    expect(result.exitStatus).toBe(2);

    const b = harness();
    const brun = b.deps.run;
    const broken = { ...b.deps, run: (c: RunCall) => (c.args[1] === "build" ? (b.calls.push(c), Promise.resolve({ status: 1, output: "build error" })) : brun(c)) };
    await runCompliance(parseArgs(["--target", "local", "--only", "KV-AC-001"]), [], broken);
    expect(b.events).toEqual([]);
    expect(recordOf(b).results.find((r) => r.id === "KV-AC-001")).toEqual({ id: "KV-AC-001", status: "not-run", detail: "not run: setting up the target failed: framework build failed with status 1" });
  });

  it("records a deliberately omitted criterion (--only) as not-run with the reason, and --blocked as blocked", async () => {
    const h = harness({ vitest: vitestReport([{ title: "[KV-AC-001] put", status: "passed" }]) });
    await runCompliance(parseArgs(["--target", "local", "--only", "KV-AC-001,KV-AC-002", "--blocked", "KV-AC-002=prerequisite x missing"]), [], h.deps);
    const vitest = h.calls.find((c) => c.args[0] === "vitest");
    const pattern = new RegExp(vitest?.args[vitest.args.indexOf("-t") + 1] ?? "");
    expect(pattern.test("[KV-AC-002] y")).toBe(false);
    expect(recordOf(h).results).toEqual([
      { id: "CLI-AC-001", status: "not-run", detail: NOT_SELECTED },
      { id: "CLI-AC-002", status: "not-run", detail: NOT_SELECTED },
      { id: "KV-AC-001", status: "passed" },
      { id: "KV-AC-002", status: "blocked", detail: "prerequisite x missing" },
    ]);
    // Records on disk carry this exact text (DEC-0261); release and traceability match it exactly.
    expect(NOT_SELECTED).toBe("not selected for this run (--only)");
  });

  it("--blocked '*=<reason>' records every criterion it would run as blocked with that detail, and deploys and runs nothing", async () => {
    const reason = "Cloudflare D1 unavailable: the account's daily D1 row limit is exhausted (Phase A spikes)";
    const h = harness();
    const result = await runCompliance(parseArgs(["--target", "cloudflare", "--blocked", `*=${reason}`]), [], h.deps);
    expect(h.calls).toEqual([]);
    expect(h.events).toEqual([]);
    expect(recordOf(h).results).toEqual([
      { id: "CLI-AC-001", status: "not-run", detail: "Google login mocked for this phase" },
      { id: "KV-AC-001", status: "blocked", detail: reason },
      { id: "KV-AC-002", status: "blocked", detail: reason },
    ]);
    expect(result.exitStatus).toBe(0);
  });

  it("runs nothing when nothing is to be run (aws without an account): every criterion not-run", async () => {
    const h = harness();
    const result = await runCompliance(parseArgs(["--target", "aws"]), [], h.deps);
    expect(h.calls).toEqual([]);
    expect(recordOf(h).results.every((r) => r.status === "not-run" && r.detail === "AWS live run pending (no account)")).toBe(true);
    expect(result.exitStatus).toBe(0);
  });
});

// G-T2 report / plan-aws.md G-T4: a skipped test's note (AWS-AC-005's not-run reason) reaches the record.
describe("[COMPL-AC-003] skip notes", () => {
  it("runs Vitest with the skip-notes reporter before the JSON reporter, and records the note as the not-run detail", async () => {
    const report = JSON.stringify({
      testResults: [{ name: "/repo/tests/compliance/criteria/a.test.ts", status: "passed", assertionResults: [{ ancestorTitles: [], title: "[KV-AC-001] put", status: "skipped", failureMessages: [], meta: { skipNote: "not-run: the cluster did not pause" } }] }],
    });
    const h = harness({ vitest: report });
    await runCompliance(parseArgs(["--target", "local", "--only", "KV-AC-001"]), [], h.deps);
    const args = h.calls.find((c) => c.args[0] === "vitest")?.args ?? [];
    expect(args.indexOf(`--reporter=${SKIP_NOTES_REPORTER}`)).toBeGreaterThan(-1);
    expect(args.indexOf(`--reporter=${SKIP_NOTES_REPORTER}`)).toBeLessThan(args.indexOf("--reporter=json"));
    expect(recordOf(h).results.filter((r) => r.id === "KV-AC-001")).toEqual([{ id: "KV-AC-001", status: "not-run", detail: "the cluster did not pause" }]);
  });
});

// plan-aws.md G-T4: `--target aws` against a fake target (the wiring a G-RUN dry run proves). The phase rule keeps every
// AWS criterion not-run without an account, so these runs pass their own not-run rules.
describe("[COMPL-AC-004] --target aws: stage naming, leftovers, cluster cap and API-call count", () => {
  const AWS = ["--target", "aws", "--only", "KV-AC-001"];
  /** `clusters` null: operations that cannot count clusters; `region` null: operations that cannot read the account's region. */
  const awsCloud = (clusters: string[] | null = [], extra: Partial<CloudStageOps> = {}, region: string | null = "us-east-1"): Partial<CloudStageOps> => ({
    deploy: (stage) => Promise.resolve({ baseUrl: "https://d111111abcdef8.cloudfront.net", output: `deployed ${stage}` }),
    ...(clusters === null ? {} : { testStageClusters: () => Promise.resolve(clusters) }),
    ...(region === null ? {} : { region: () => Promise.resolve(region) }),
    apiCalls: () => 3,
    ...extra,
  });
  const ownEnv = (name: string, value: string | undefined): (() => void) => {
    const saved = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    return () => {
      if (saved === undefined) delete process.env[name];
      else process.env[name] = saved;
    };
  };

  it("deploys test-<runId> after counting clusters, hands the tests the API-call budget, removes the stage and records leftovers and usage", async () => {
    const restore = ownEnv("COMPLIANCE_AWS_MAX_RUN_CALLS", undefined);
    try {
      const events: string[] = [];
      const h = harness({
        notRunRules: [],
        vitest: vitestReport([{ title: "[KV-AC-001] put", status: "passed" }]),
        vitestOutput: `\n${AWS_CALLS_REPORT_PREFIX}12\n${AWS_CALLS_REPORT_PREFIX}5\n`,
        cloud: awsCloud(["reference-test-other00000001"], {
          testStageClusters: () => (events.push("count clusters"), Promise.resolve(["reference-test-other00000001", "prodcluster"])),
          listStageResources: (s) => (events.push(`leftovers ${s}`), Promise.resolve([`Lambda function reference-${s}-http`])),
        }),
      });
      const result = await runCompliance(parseArgs(AWS), AWS, h.deps);
      expect(h.events.filter((e) => /^(pending|deploy|remove|secret)/.test(e))).toEqual([
        "pending+ test-abcdefghij12345",
        "secret apiKey test-abcdefghij12345",
        "remove test-abcdefghij12345",
      ]);
      expect(events).toEqual(["count clusters", "leftovers test-abcdefghij12345"]);
      const vitest = h.calls.find((c) => c.args[0] === "vitest");
      expect(vitest?.env.COMPLIANCE_TARGET).toBe("aws");
      expect(vitest?.env.COMPLIANCE_STAGE).toBe("test-abcdefghij12345");
      expect(vitest?.env.COMPLIANCE_BASE_URL).toBe("https://d111111abcdef8.cloudfront.net");
      expect(vitest?.env.COMPLIANCE_AWS_MAX_CALLS).toBe("2000");
      expect(h.calls.find((c) => c.args[0] === "playwright")?.env.COMPLIANCE_AWS_MAX_CALLS).toBe(String(2000 - 17));
      const record = recordOf(h);
      expect(record).toMatchObject({ target: "aws", stage: "test-abcdefghij12345" });
      expect(record.results).toEqual([
        { id: "CLI-AC-001", status: "not-run", detail: "not selected for this run (--only)" },
        { id: "KV-AC-001", status: "passed" },
        { id: "KV-AC-002", status: "not-run", detail: "not selected for this run (--only)" },
      ]);
      expect(record.leftovers).toEqual(["test-abcdefghij12345: Lambda function reference-test-abcdefghij12345-http"]);
      const usage = h.written[0]?.raw?.["aws-usage.log"] ?? "";
      expect(usage).toContain("test-stage Aurora clusters before deploying test-abcdefghij12345: 1 (reference-test-other00000001)");
      expect(usage).toContain("vitest: 17 AWS API call(s) by the test hooks");
      expect(usage).toContain("total: 20 of the run's cap 2000");
      expect(h.logs.join("\n")).toContain("aws api calls by the test hooks: 20 (cap 2000)");
      expect(result.exitStatus).toBe(1); // the leftover
    } finally {
      restore();
    }
  });

  it("refuses to deploy a fourth Aurora cluster: nothing deployed or added to the pending list, the reason recorded", async () => {
    const h = harness({ notRunRules: [], cloud: awsCloud(["reference-test-a00000000000001", "reference-test-b00000000000001", "notes-test-c00000000000001"]) });
    const result = await runCompliance(parseArgs(AWS), AWS, h.deps);
    expect(h.events.filter((e) => /^(pending|deploy)/.test(e))).toEqual([]);
    expect(h.calls.filter((c) => c.args[0] === "vitest")).toEqual([]);
    expect(recordOf(h).results.find((r) => r.id === "KV-AC-001")?.detail).toMatch(/^not run: setting up the target failed: deploying test-abcdefghij12345 would hold 4 Aurora clusters at once .*at most 3 at once/);
    expect(result.exitStatus).toBe(1);
  });

  it("refuses a stage whose AWS names would be invalid, and operations that cannot count clusters", async () => {
    const bad = harness({ notRunRules: [], cloud: awsCloud() });
    await runCompliance(parseArgs(["--target", "aws", "--stage", "test-a--b", "--only", "KV-AC-001"]), [], bad.deps);
    expect(bad.events.filter((e) => e.startsWith("deploy"))).toEqual([]);
    expect(recordOf(bad).results.find((r) => r.id === "KV-AC-001")?.detail).toMatch(/stage test-a--b cannot be deployed on AWS: .*doubled hyphen/);

    const blind = harness({ notRunRules: [], cloud: awsCloud(null) });
    await runCompliance(parseArgs(AWS), AWS, blind.deps);
    expect(blind.events.filter((e) => e.startsWith("deploy"))).toEqual([]);
    expect(recordOf(blind).results.find((r) => r.id === "KV-AC-001")?.detail).toMatch(/cannot count the account's Aurora clusters/);
  });

  it("passing the run's API-call cap fails the run, and no further test run starts once the budget is used", async () => {
    const restore = ownEnv("COMPLIANCE_AWS_MAX_RUN_CALLS", "10");
    try {
      const h = harness({ notRunRules: [], vitest: vitestReport([{ title: "[KV-AC-001] put", status: "passed" }]), vitestOutput: `\n${AWS_CALLS_REPORT_PREFIX}12\n`, cloud: awsCloud() });
      const result = await runCompliance(parseArgs(AWS), AWS, h.deps);
      expect(h.calls.find((c) => c.args[0] === "vitest")?.env.COMPLIANCE_AWS_MAX_CALLS).toBe("10");
      expect(h.calls.filter((c) => c.args[0] === "playwright")).toEqual([]);
      expect(h.written[0]?.raw?.["run-errors.log"]).toContain("playwright: not run: the run's AWS API-call cap (10) is used up");
      expect(h.logs.join("\n")).toMatch(/passed its AWS API-call cap \(15 > 10/);
      expect(result.exitStatus).toBe(1);
      expect(h.events).toContain("remove test-abcdefghij12345");
    } finally {
      restore();
    }
  });

  it("removes stages an interrupted AWS run left before counting clusters, and keeps one it could not remove", async () => {
    const h = harness({
      notRunRules: [],
      pending: ["test-old000000000001"],
      cloud: awsCloud([], { listStageResources: (s) => Promise.resolve(s === "test-old000000000001" ? ["Aurora cluster reference-test-old000000000001"] : []) }),
    });
    await runCompliance(parseArgs(AWS), AWS, h.deps);
    expect(h.events.filter((e) => /^(remove|deploy) /.test(e))[0]).toBe("remove test-old000000000001");
    expect(recordOf(h).leftovers).toEqual(["test-old000000000001: Aurora cluster reference-test-old000000000001"]);
    expect(h.pending.get("aws")?.has("test-old000000000001")).toBe(true);
  });

  // G-EV F4: the AWS test hooks take the account region from AWS_REGION; the driver sets it from the account (DEC-0075, DEC-0476).
  it("gives every test process and the cluster count the account's region as AWS_REGION and AWS_DEFAULT_REGION", async () => {
    const restore = [ownEnv("AWS_REGION", "us-west-1"), ownEnv("AWS_DEFAULT_REGION", undefined)];
    try {
      const asked: string[] = [];
      const h = harness({
        notRunRules: [],
        vitest: vitestReport([{ title: "[KV-AC-001] put", status: "passed" }]),
        cloud: awsCloud([], { region: () => Promise.resolve("eu-west-2"), testStageClusters: (region) => (asked.push(region), Promise.resolve([])) }),
      });
      await runCompliance(parseArgs(AWS), AWS, h.deps);
      const tests = h.calls.filter((c) => c.args[0] === "vitest" || c.args[0] === "playwright");
      expect(tests.map((c) => c.args[0])).toEqual(["vitest", "playwright"]);
      for (const c of tests) expect([c.env.AWS_REGION, c.env.AWS_DEFAULT_REGION]).toEqual(["eu-west-2", "eu-west-2"]);
      expect(asked).toEqual(["eu-west-2"]);
      expect(h.written[0]?.raw?.["aws-usage.log"]).toContain("account region: eu-west-2");
      expect(h.logs.join("\n")).toMatch(/AWS_REGION=us-west-1 is not the account's region eu-west-2/);
    } finally {
      for (const r of restore) r();
    }
  });

  it("without the account's region, falls back to AWS_REGION, then AWS_DEFAULT_REGION", async () => {
    for (const [name, value] of [["AWS_REGION", "ap-south-1"], ["AWS_DEFAULT_REGION", "sa-east-1"]] as const) {
      const restore = [ownEnv("AWS_REGION", undefined), ownEnv("AWS_DEFAULT_REGION", undefined), ownEnv(name, value)];
      try {
        const h = harness({ notRunRules: [], vitest: vitestReport([{ title: "[KV-AC-001] put", status: "passed" }]), cloud: awsCloud([], {}, null) });
        await runCompliance(parseArgs(AWS), AWS, h.deps);
        expect(h.calls.find((c) => c.args[0] === "vitest")?.env.AWS_REGION).toBe(value);
      } finally {
        for (const r of restore.reverse()) r();
      }
    }
  });

  it("with no region to be found, stops with a missing prerequisite before deploying or running any test", async () => {
    const restore = [ownEnv("AWS_REGION", undefined), ownEnv("AWS_DEFAULT_REGION", undefined)];
    try {
      const failing: Partial<CloudStageOps> = { region: () => Promise.reject(new Error("AWS credentials are not usable: STS GetCallerIdentity failed with ExpiredToken")) };
      for (const [extra, region] of [[{}, null], [failing, "us-east-1"]] as const) {
        const counted: string[] = [];
        const h = harness({ notRunRules: [], cloud: awsCloud([], { ...extra, testStageClusters: () => (counted.push("count"), Promise.resolve([])) }, region) });
        const result = await runCompliance(parseArgs(AWS), AWS, h.deps);
        expect(h.events.filter((e) => /^(pending|deploy|secret)/.test(e))).toEqual([]);
        expect(counted).toEqual([]);
        expect(h.calls.filter((c) => c.args[0] === "vitest" || c.args[0] === "playwright")).toEqual([]);
        expect(h.written[0]?.raw?.["driver-error.log"]).toMatch(/^PrerequisiteMissingError: PREREQUISITE MISSING: the AWS account's region/);
        const detail = recordOf(h).results.find((r) => r.id === "KV-AC-001")?.detail ?? "";
        expect(detail).toMatch(/^not run: setting up the target failed: PREREQUISITE MISSING: the AWS account's region .*(setup-account --target aws|ExpiredToken)/);
        expect(result.exitStatus).toBe(1);
      }
    } finally {
      for (const r of restore) r();
    }
  });

  // G-EV F3: a run against fakes says so in its record, so no report can count it whatever folder it lands in.
  it("marks the record as a dry run when the not-run rules are overridden or the stage operations are fakes, and only then", async () => {
    const overridden = harness({ notRunRules: [], cloud: awsCloud() });
    await runCompliance(parseArgs(AWS), AWS, overridden.deps);
    expect(recordOf(overridden).dryRun).toBe("not-run rules overridden (DriverDeps.notRunRules)");
    expect(overridden.logs.join("\n")).toMatch(/dry run \(not-run rules overridden.*\): this record is not evidence/);

    const faked = harness({ notRunRules: [], cloud: awsCloud([], { dryRun: "fake OperationsFactory" }) });
    await runCompliance(parseArgs(AWS), AWS, faked.deps);
    expect(recordOf(faked).dryRun).toBe("not-run rules overridden (DriverDeps.notRunRules); fake OperationsFactory");

    const fakeOpsOnly = harness({ cloud: { dryRun: "fake framework CLI runner" } });
    await runCompliance(parseArgs(["--target", "cloudflare", "--only", "KV-AC-001"]), [], fakeOpsOnly.deps);
    expect(recordOf(fakeOpsOnly).dryRun).toBe("fake framework CLI runner");

    const real = harness();
    await runCompliance(parseArgs(["--target", "aws"]), [], real.deps);
    expect(recordOf(real)).not.toHaveProperty("dryRun");
    const local = harness();
    await runCompliance(parseArgs(["--target", "local"]), [], local.deps);
    expect(recordOf(local)).not.toHaveProperty("dryRun");
  });
});

// Root cause 2026-10-20-E2E-004-coverage-and-not-run, cause B: unit-level criteria reach the record.
describe("[COMPL-AC-003] unit-level criteria", () => {
  const catalogue = [entry("KV-AC-001", "Local, cloud"), entry("COMPL-AC-007", "Local"), entry("CLI-AC-002", "Local")];
  const unitReport = vitestReport([
    { title: "[COMPL-AC-007] lowest-numbered database is current", status: "passed" },
    { title: 'test tags > rejects the malformed ID "[KV-AC-001]"', status: "passed" },
    { title: "[CLI-AC-002][COMPL-AC-007] a unit test also tagged with a non-unit-level ID", status: "passed" },
  ]);

  it("local: runs the unit config once for the unit-level IDs and folds only those IDs", async () => {
    const h = harness({ catalogue, unitVitest: unitReport });
    await runCompliance(parseArgs(["--target", "local"]), [], h.deps);
    const units = h.calls.filter((c) => c.args.includes("vitest.unit.config.ts"));
    expect(units).toHaveLength(1);
    const pattern = new RegExp(units[0]?.args[units[0].args.indexOf("-t") + 1] ?? "");
    expect(pattern.test("[COMPL-AC-007] x")).toBe(true);
    expect(pattern.test("[KV-AC-001] x")).toBe(false);
    expect(pattern.test("[CLI-AC-002] x")).toBe(false);
    expect(h.events).toEqual(["run run", "run run", "start dev", "run vitest", "run vitest", "run playwright", "stop dev"]);
    expect(recordOf(h).results).toEqual([
      { id: "CLI-AC-002", status: "not-run", detail: "no test tagged [CLI-AC-002] ran on local" },
      { id: "COMPL-AC-007", status: "passed" },
      { id: "KV-AC-001", status: "not-run", detail: "no test tagged [KV-AC-001] ran on local" },
    ]);
    expect(Object.keys(h.written[0]?.raw ?? {})).toEqual(expect.arrayContaining(["vitest-unit.json", "vitest-unit.log"]));
  });

  it("no unit call when no unit-level ID is to be run, and none on a cloud target", async () => {
    const h = harness({ catalogue, unitVitest: unitReport });
    await runCompliance(parseArgs(["--target", "local", "--only", "KV-AC-001"]), [], h.deps);
    expect(h.calls.filter((c) => c.args.includes("vitest.unit.config.ts"))).toEqual([]);
    const c = harness({ catalogue: [...catalogue, entry("GOOGLE-AC-002", "Local, cloud")], unitVitest: unitReport });
    await runCompliance(parseArgs(["--target", "cloudflare"]), [], c.deps);
    expect(c.calls.filter((call) => call.args.includes("vitest.unit.config.ts"))).toEqual([]);
  });
});

describe("[COMPL-AC-004] cloud runs use a disposable test stage", () => {
  it("deploys test-<runId>, passes NODE_USE_ENV_PROXY, removes the stage, and redacts the account subdomain", async () => {
    const h = harness({ vitest: vitestReport([{ title: "[KV-AC-001] put", status: "passed" }]) });
    await runCompliance(parseArgs(["--target", "cloudflare"]), ["--target", "cloudflare"], h.deps);
    expect(h.events).toEqual([
      "run run",
      "run run",
      "pending+ test-abcdefghij12345",
      "deploy test-abcdefghij12345",
      "secret apiKey test-abcdefghij12345",
      "deploy test-abcdefghij12345",
      "run vitest",
      "run playwright",
      "remove test-abcdefghij12345",
      "pending- test-abcdefghij12345",
    ]);
    const vitest = h.calls.find((c) => c.args[0] === "vitest");
    expect(vitest?.env.NODE_USE_ENV_PROXY).toBe("1");
    expect(vitest?.env.COMPLIANCE_STAGE).toBe("test-abcdefghij12345");
    expect(vitest?.args).toContain("tests/compliance/criteria");
    const record = recordOf(h);
    expect(record.stage).toBe("test-abcdefghij12345");
    expect(record.leftovers).toEqual([]);
    expect(record.results.find((r) => r.id === "CLI-AC-001")).toEqual({ id: "CLI-AC-001", status: "not-run", detail: "Google login mocked for this phase" });
    expect(h.written[0]?.redactions).toContainEqual({ value: "owner-sub", replacement: "<account-subdomain>" });
  });

  it("a failed deploy runs no tests, records the reason, still removes the stage, and lists leftovers", async () => {
    const h = harness({
      cloud: { deploy: () => Promise.reject(new Error("deploy failed at step 3\nmore")), listStageResources: () => Promise.resolve(["worker reference-test-abcdefghij12345"]) },
    });
    const result = await runCompliance(parseArgs(["--target", "cloudflare"]), [], h.deps);
    expect(h.calls.filter((c) => c.args[0] === "vitest")).toEqual([]);
    const record = recordOf(h);
    expect(record.results.find((r) => r.id === "KV-AC-001")).toEqual({ id: "KV-AC-001", status: "not-run", detail: "not run: setting up the target failed: deploy failed at step 3" });
    expect(record.leftovers).toEqual(["test-abcdefghij12345: worker reference-test-abcdefghij12345"]);
    expect(h.pending.get("cloudflare")?.has("test-abcdefghij12345")).toBe(true);
    expect(result.exitStatus).toBe(1);
  });

  it("cleans up a stage left by an interrupted earlier run, and reports what remains", async () => {
    const h = harness({ pending: ["test-old000000000001"], cloud: { listStageResources: (s) => Promise.resolve(s === "test-old000000000001" ? ["r2-token test-old000000000001"] : []) } });
    await runCompliance(parseArgs(["--target", "cloudflare", "--only", "KV-AC-001"]), [], h.deps);
    expect(h.events.filter((e) => /^(remove|deploy) /.test(e))).toEqual(["remove test-old000000000001", "deploy test-abcdefghij12345", "deploy test-abcdefghij12345", "remove test-abcdefghij12345"]);
    expect(recordOf(h).leftovers).toEqual(["test-old000000000001: r2-token test-old000000000001"]);
  });

  it("never removes a pending stage that is not a test stage (prodcheck)", async () => {
    const h = harness({ pending: ["prodcheck"] });
    await runCompliance(parseArgs(["--target", "cloudflare", "--only", "KV-AC-001"]), [], h.deps);
    expect(h.events.filter((e) => e.includes("prodcheck"))).toEqual([]);
    expect(recordOf(h).leftovers).toEqual([]);
    expect(h.logs.join("\n")).toMatch(/prodcheck.*test stages only/);
  });

  it("a leftover check that cannot run is recorded, never read as no leftovers", async () => {
    const h = harness({ cloud: { listStageResources: () => Promise.reject(new Error("listStageResources is not available")) } });
    await runCompliance(parseArgs(["--target", "cloudflare", "--only", "KV-AC-001"]), [], h.deps);
    expect(recordOf(h).leftovers).toEqual(["test-abcdefghij12345: leftover check failed: listStageResources is not available"]);
  });

  it("with --stage and --base-url uses that stage as is: no deploy, no removal", async () => {
    const h = harness();
    await runCompliance(parseArgs(["--target", "cloudflare", "--stage", "test-given", "--base-url", "https://x.y.workers.dev"]), [], h.deps);
    expect(h.events.filter((e) => /deploy|remove/.test(e))).toEqual([]);
    expect(recordOf(h).stage).toBe("test-given");
  });

  it("milestone runs expect only milestone items", async () => {
    const h = harness();
    await runCompliance(parseArgs(["--target", "cloudflare", "--milestone"]), [], h.deps);
    expect(recordOf(h).results.map((r) => r.id)).toEqual(["PROV-AC-003"]);
  });
});

// DEC-0277, DEC-0366, D-07: on a cloud run stage the driver sets the reference app's test secret `apiKey` to a value it
// generates, passes it to the tests in COMPLIANCE_SECRET_API_KEY, and never lets it reach the evidence, raw output or log.
describe("[COMPL-AC-004] the test secret on a cloud run stage (DEC-0277)", () => {
  const stopsOnSecrets = (events: string[]): Partial<CloudStageOps> => {
    let deploys = 0;
    return {
      deploy: (stage) => {
        events.push(`deploy ${stage}`);
        deploys += 1;
        if (deploys === 1) return Promise.reject(new SecretsNotSetError("deploy failed at step code: required secrets are not set: apiKey", "first deploy output"));
        return Promise.resolve({ baseUrl: "https://reference-test.owner-sub.workers.dev", output: "redeployed" });
      },
    };
  };
  const files = (dir: string): string[] =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => join(d.parentPath, d.name));

  it("first deploy stops on the unset secret: sets a generated value with secrets set, redeploys, and passes it to the tests only", async () => {
    const events: string[] = [];
    const set: { stage: string; name: string; value: string }[] = [];
    const h = harness({
      cloud: {
        ...stopsOnSecrets(events),
        setSecret: (stage, name, value) => (events.push(`secret ${name} ${stage}`), set.push({ stage, name, value }), Promise.resolve("set secret apiKey")),
      },
    });
    await runCompliance(parseArgs(["--target", "cloudflare", "--only", "KV-AC-001"]), [], h.deps);
    expect(events).toEqual(["deploy test-abcdefghij12345", "secret apiKey test-abcdefghij12345", "deploy test-abcdefghij12345"]);
    expect(set).toEqual([{ stage: "test-abcdefghij12345", name: "apiKey", value: SECRET }]);
    const tests = h.calls.filter((c) => c.args[0] === "vitest" || c.args[0] === "playwright");
    expect(tests.length).toBeGreaterThan(0);
    for (const c of tests) {
      expect(c.env.COMPLIANCE_SECRET_API_KEY).toBe(SECRET);
      // The test runners' live echo hides it too.
      expect(c.redact).toEqual([SECRET]);
    }
    // Never on a command line, and not given to the build or typecheck.
    for (const c of h.calls) expect(c.args.join(" ")).not.toContain(SECRET);
    for (const c of h.calls.filter((x) => x.command === "npm")) expect(c.env.COMPLIANCE_SECRET_API_KEY).toBeUndefined();
    const raw = h.written[0]?.raw ?? {};
    expect(raw["deploy.log"]).toBe("first deploy output");
    expect(raw["secrets-set.log"]).toBe("set secret apiKey");
    expect(raw["redeploy.log"]).toBe("redeployed");
    expect(h.written[0]?.redactions).toContainEqual({ value: SECRET, replacement: "<test-secret>" });
  });

  it("a stage whose first deploy succeeds (a reused --stage) still gets the generated value and a redeploy", async () => {
    const h = harness();
    await runCompliance(parseArgs(["--target", "cloudflare", "--stage", "test-reused", "--only", "KV-AC-001"]), [], h.deps);
    expect(h.events.filter((e) => /^(deploy|secret|remove) /.test(e))).toEqual(["deploy test-reused", "secret apiKey test-reused", "deploy test-reused", "remove test-reused"]);
    expect(h.calls.find((c) => c.args[0] === "vitest")?.env.COMPLIANCE_SECRET_API_KEY).toBe(SECRET);
  });

  it("evidence and raw output written by the real writer never contain the value, even when a test prints it", async () => {
    const root = mkdtempSync(join(tmpdir(), "d07-evidence-"));
    try {
      const h = harness({ vitest: vitestReport([{ title: "[KV-AC-001] put", status: "failed", message: `expected body not to contain ${SECRET}` }]), vitestStatus: 1 });
      const run = h.deps.run;
      const deps: DriverDeps = {
        ...h.deps,
        run: async (c) => {
          const r = await run(c);
          return { ...r, output: `${r.output} saw ${c.env.COMPLIANCE_SECRET_API_KEY ?? ""}` };
        },
        writeEvidence: (input) => writeEvidence({ ...input, root }),
      };
      const result = await runCompliance(parseArgs(["--target", "cloudflare", "--only", "KV-AC-001"]), [], deps);
      const written = files(root);
      expect(written.some((f) => f.endsWith("abcdefghij12345.json"))).toBe(true);
      const log = written.find((f) => f.endsWith("vitest.log"));
      expect(log).toBeDefined();
      for (const f of written) expect(readFileSync(f, "utf8"), f).not.toContain(SECRET);
      expect(readFileSync(log ?? "", "utf8")).toContain("<test-secret>");
      expect(h.logs.join("\n")).not.toContain(SECRET);
      expect(result.exitStatus).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a failed secrets set runs no tests, records the reason without the value, and still removes the stage", async () => {
    const events: string[] = [];
    const h = harness({
      cloud: {
        ...stopsOnSecrets(events),
        setSecret: () => Promise.reject(new Error("secrets set apiKey --target cloudflare --stage test-abcdefghij12345 failed with status 1")),
        remove: (s) => (events.push(`remove ${s}`), Promise.resolve("removed")),
      },
    });
    const result = await runCompliance(parseArgs(["--target", "cloudflare", "--only", "KV-AC-001"]), [], h.deps);
    expect(h.calls.filter((c) => c.args[0] === "vitest")).toEqual([]);
    expect(recordOf(h).results.find((r) => r.id === "KV-AC-001")?.detail).toBe(
      "not run: setting up the target failed: secrets set apiKey --target cloudflare --stage test-abcdefghij12345 failed with status 1",
    );
    expect(events).toContain("remove test-abcdefghij12345");
    expect(h.written[0]?.redactions).toContainEqual({ value: SECRET, replacement: "<test-secret>" });
    expect(result.exitStatus).toBe(1);
  });

  it("a first deploy that fails for another reason is not retried and sets no secret", async () => {
    const h = harness({ cloud: { deploy: (s) => (h.events.push(`deploy ${s}`), Promise.reject(new Error("deploy failed at step infrastructure"))) } });
    await runCompliance(parseArgs(["--target", "cloudflare", "--only", "KV-AC-001"]), [], h.deps);
    expect(h.events.filter((e) => /^(deploy|secret) /.test(e))).toEqual(["deploy test-abcdefghij12345"]);
  });

  it("local runs and cloud runs on a given --base-url generate and set nothing (the local value stays in .dev.vars)", async () => {
    let generated = 0;
    const local = harness();
    await runCompliance(parseArgs(["--target", "local", "--only", "KV-AC-001"]), [], { ...local.deps, newTestSecret: () => (generated++, SECRET) });
    expect(local.calls.find((c) => c.args[0] === "vitest")?.redact).toBeUndefined();
    const given = harness();
    await runCompliance(parseArgs(["--target", "cloudflare", "--base-url", "https://x.y.workers.dev", "--only", "KV-AC-001"]), [], { ...given.deps, newTestSecret: () => (generated++, SECRET) });
    expect(given.events.filter((e) => e.startsWith("secret "))).toEqual([]);
    expect(generated).toBe(0);
  });
});

// CLI-AC-003 (CLI-REQ-003) for the compliance runner: injected failures, including failures during cleanup (stopping
// `dev`, removing the test stage, the leftover check), give a non-zero exit status that reflects the original failure.
// Decisions: DEC-0394…DEC-0397 (docs/decisions/decision-log.md, Item: C-T6).
describe("[CLI-AC-003] compliance runner exit status under injected failures", () => {
  const failingTest = vitestReport([{ title: "[KV-AC-001] put", status: "failed", message: "expected 200, got 500" }]);
  const LOCAL = ["--target", "local", "--only", "KV-AC-001"];
  const CLOUD = ["--target", "cloudflare", "--only", "KV-AC-001"];

  it("[CLI-AC-003] local: a failing tagged test gives the runner's non-zero status, records the failure and still stops dev", async () => {
    const h = harness({ vitest: failingTest, vitestStatus: 1 });
    const result = await runCompliance(parseArgs(LOCAL), LOCAL, h.deps);
    expect(result.exitStatus).toBe(1);
    expect(recordOf(h).exitStatus).toBe(1);
    expect(recordOf(h).results.find((r) => r.id === "KV-AC-001")).toEqual({ id: "KV-AC-001", status: "failed", detail: "1 of 1 tests failed: [KV-AC-001] put: expected 200, got 500" });
    expect(h.events.at(-1)).toBe("stop dev");
  });

  it("[CLI-AC-003] local: a failing test whose cleanup (stopping dev) also fails keeps the original status and still writes the record", async () => {
    const h = harness({ vitest: failingTest, vitestStatus: 1 });
    const deps: DriverDeps = { ...h.deps, startLocal: () => Promise.resolve({ baseUrl: "http://localhost:5173", stop: () => Promise.reject(new Error("dev did not stop")) }) };
    const result = await runCompliance(parseArgs(LOCAL), LOCAL, deps);
    expect(result.exitStatus).toBe(1);
    const record = recordOf(h);
    expect(record.exitStatus).toBe(1);
    expect(record.results.find((r) => r.id === "KV-AC-001")?.status).toBe("failed");
    expect(JSON.stringify(h.written[0]?.raw ?? {})).toContain("dev did not stop");
  });

  it("[CLI-AC-003] cloud: a failing test whose stage removal fails keeps the original status, records leftovers and keeps the stage pending", async () => {
    const h = harness({
      vitest: failingTest,
      vitestStatus: 1,
      cloud: { remove: () => Promise.reject(new Error("remove refused")), listStageResources: () => Promise.resolve(["worker reference-test-abcdefghij12345"]) },
    });
    const result = await runCompliance(parseArgs(CLOUD), CLOUD, h.deps);
    expect(result.exitStatus).toBe(1);
    const record = recordOf(h);
    expect(record.exitStatus).toBe(1);
    expect(record.results.find((r) => r.id === "KV-AC-001")?.status).toBe("failed");
    expect(record.leftovers).toEqual(["test-abcdefghij12345: worker reference-test-abcdefghij12345"]);
    expect(h.written[0]?.raw?.["remove-test-abcdefghij12345.log"]).toContain("remove refused");
    expect(h.pending.get("cloudflare")?.has("test-abcdefghij12345")).toBe(true);
  });

  it("[CLI-AC-003] cloud: a failed deploy whose removal and leftover check also fail keeps status 1 and the deploy failure as the reason", async () => {
    const h = harness({
      cloud: {
        deploy: () => Promise.reject(new Error("deploy failed at step 3")),
        remove: () => Promise.reject(new Error("remove refused")),
        listStageResources: () => Promise.reject(new Error("listing refused")),
      },
    });
    const result = await runCompliance(parseArgs(CLOUD), CLOUD, h.deps);
    expect(result.exitStatus).toBe(1);
    const record = recordOf(h);
    expect(record.exitStatus).toBe(1);
    expect(record.results.find((r) => r.id === "KV-AC-001")).toEqual({ id: "KV-AC-001", status: "not-run", detail: "not run: setting up the target failed: deploy failed at step 3" });
    expect(record.leftovers).toEqual(["test-abcdefghij12345: leftover check failed: listing refused"]);
    expect(h.pending.get("cloudflare")?.has("test-abcdefghij12345")).toBe(true);
  });

  // Root cause 2026-10-20-compliance-cli-exit-and-pending-stages (F2): a failed pending-stage list write.
  const failingPendingRemove = (h: Harness): DriverDeps => ({
    ...h.deps,
    pendingStages: {
      ...h.deps.pendingStages,
      remove: (_t, s) => {
        h.events.push(`pending- ${s} THROW`);
        throw new Error("EACCES: permission denied, open '.framework/compliance/pending-stages.json'");
      },
    },
  });

  it("[CLI-AC-003] cloud: the run's own stage is removed but the pending-stage list cannot be updated: the record is still written, exit 1", async () => {
    const h = harness({ vitest: vitestReport([{ title: "[KV-AC-001] put", status: "passed" }]) });
    const result = await runCompliance(parseArgs(CLOUD), CLOUD, failingPendingRemove(h));
    expect(h.written).toHaveLength(1);
    const record = recordOf(h);
    expect(record.results.find((r) => r.id === "KV-AC-001")?.status).toBe("passed");
    expect(result.exitStatus).toBe(1);
    expect(record.exitStatus).toBe(1);
    expect(record.leftovers).toEqual([]);
    expect(h.written[0]?.raw?.["pending-stages.log"]).toContain("EACCES");
    expect(h.logs.join("\n")).toMatch(/test-abcdefghij12345 was removed, but the pending-stage list could not be updated/);
  });

  it("[CLI-AC-003] cloud: a stale stage is removed but the pending-stage list cannot be updated: the stage is still deployed and tested, exit 1", async () => {
    const h = harness({ pending: ["test-oldoldoldold123"], vitest: vitestReport([{ title: "[KV-AC-001] put", status: "passed" }]) });
    const result = await runCompliance(parseArgs(CLOUD), CLOUD, failingPendingRemove(h));
    expect(h.events).toEqual(expect.arrayContaining(["remove test-oldoldoldold123", "deploy test-abcdefghij12345", "run vitest"]));
    expect(h.written).toHaveLength(1);
    const record = recordOf(h);
    expect(record.results.find((r) => r.id === "KV-AC-001")?.status).toBe("passed");
    expect(h.written[0]?.raw?.["driver-error.log"]).toBeUndefined();
    expect(h.written[0]?.raw?.["pending-stages.log"]).toContain("test-oldoldoldold123: could not update the pending-stage list: EACCES");
    expect(result.exitStatus).toBe(1);
    expect(record.exitStatus).toBe(1);
  });

  it("[CLI-AC-003] cloud: a failing test run (runner status 3) whose pending-stage list update also fails keeps status 3", async () => {
    const h = harness({ vitest: failingTest, vitestStatus: 3 });
    const result = await runCompliance(parseArgs(CLOUD), CLOUD, failingPendingRemove(h));
    expect(h.written).toHaveLength(1);
    const record = recordOf(h);
    expect(record.results.find((r) => r.id === "KV-AC-001")?.status).toBe("failed");
    expect(result.exitStatus).toBe(3);
    expect(record.exitStatus).toBe(3);
  });

  it("[CLI-AC-003] cloud: passing tests whose stage cleanup fails (a partial failure) give a non-zero status", async () => {
    const cases: Partial<CloudStageOps>[] = [
      { remove: () => Promise.reject(new Error("remove refused")), listStageResources: () => Promise.resolve(["worker reference-test-abcdefghij12345"]) },
      { listStageResources: () => Promise.reject(new Error("listing refused")) },
    ];
    for (const cloud of cases) {
      const h = harness({ vitest: vitestReport([{ title: "[KV-AC-001] put", status: "passed" }]), cloud });
      const result = await runCompliance(parseArgs(CLOUD), CLOUD, h.deps);
      expect(recordOf(h).results.find((r) => r.id === "KV-AC-001")?.status).toBe("passed");
      expect(result.exitStatus).not.toBe(0);
      expect(recordOf(h).exitStatus).toBe(result.exitStatus);
    }
  });
});
