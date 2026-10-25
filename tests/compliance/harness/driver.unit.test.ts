import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateEvidence, writeEvidence, type EvidenceRecord, type GitState, type WriteEvidenceInput } from "../../../packages/framework/src/evidence/public.js";
import { parseArgs } from "./args.js";
import { NOT_SELECTED, parseWhere, type CatalogueEntry } from "./catalogue.js";
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
      { id: "CLI-AC-001", status: "not-run", detail: "password login provider not implemented yet (DEC-0509)" },
      { id: "KV-AC-001", status: "blocked", detail: reason },
      { id: "KV-AC-002", status: "blocked", detail: reason },
    ]);
    expect(result.exitStatus).toBe(0);
  });

  // DEC-0508: release 1 is local and Cloudflare; an AWS-only criterion is never expected, on any target.
  it("never demands an AWS criterion: an AWS-only entry is neither run nor recorded on local or cloudflare", async () => {
    const catalogue = [...CATALOGUE, entry("AWS-AC-001", "Cloud", "components/aws.md")];
    for (const target of ["local", "cloudflare"]) {
      const h = harness({ catalogue, vitest: vitestReport([{ title: "[KV-AC-001] put", status: "passed" }]) });
      await runCompliance(parseArgs(["--target", target]), [], h.deps);
      const ids = recordOf(h).results.map((r) => r.id);
      expect(ids).not.toContain("AWS-AC-001");
      expect(ids).toContain("KV-AC-001");
      for (const c of h.calls) expect(c.args.join(" ")).not.toContain("AWS-AC-001");
    }
  });
});

// DEC-0500: a skipped test's note (its not-run reason) reaches the record.
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

// G-EV F3 (DEC-0504): the dry-run marker, kept for release 1.
describe("[COMPL-AC-003] dry runs", () => {
  const CF = ["--target", "cloudflare", "--only", "KV-AC-001"];
  // G-EV F3: a run against fakes says so in its record, so no report can count it whatever folder it lands in.
  it("marks the record as a dry run when the not-run rules are overridden or the stage operations are fakes, and only then", async () => {
    const overridden = harness({ notRunRules: [] });
    await runCompliance(parseArgs(CF), CF, overridden.deps);
    expect(recordOf(overridden).dryRun).toBe("not-run rules overridden (DriverDeps.notRunRules)");
    expect(overridden.logs.join("\n")).toMatch(/dry run \(not-run rules overridden.*\): this record is not evidence/);

    const faked = harness({ notRunRules: [], cloud: { dryRun: "fake OperationsFactory" } });
    await runCompliance(parseArgs(CF), CF, faked.deps);
    expect(recordOf(faked).dryRun).toBe("not-run rules overridden (DriverDeps.notRunRules); fake OperationsFactory");

    const fakeOpsOnly = harness({ cloud: { dryRun: "fake framework CLI runner" } });
    await runCompliance(parseArgs(["--target", "cloudflare", "--only", "KV-AC-001"]), [], fakeOpsOnly.deps);
    expect(recordOf(fakeOpsOnly).dryRun).toBe("fake framework CLI runner");

    const real = harness();
    await runCompliance(parseArgs(["--target", "cloudflare"]), [], real.deps);
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
    expect(record.results.find((r) => r.id === "CLI-AC-001")).toEqual({ id: "CLI-AC-001", status: "not-run", detail: "password login provider not implemented yet (DEC-0509)" });
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

// COMPL-REQ-005 as amended (DEC-0512): on a cloud run the driver redeploys prodcheck before the
// test layers and runs check-login on it after them, folding its record's results in (prodcheck.ts).
describe("[COMPL-AC-005] the production checks on prodcheck", () => {
  const catalogue = [entry("KV-AC-001", "Local, cloud"), entry("PWD-AC-009", "Cloud"), entry("AUTH-AC-011", "Cloud"), entry("E2E-008", "Cloud")];
  const checkLoginRecord = (results: EvidenceRecord["results"]): EvidenceRecord => ({
    runId: "cl1",
    commit: "c0ffee",
    target: "cloudflare",
    stage: "prodcheck",
    command: "check-login --target cloudflare --stage prodcheck",
    startedAt: "2026-10-20T10:00:00.000Z",
    finishedAt: "2026-10-20T10:01:00.000Z",
    exitStatus: results.every((r) => r.status === "passed") ? 0 : 1,
    results,
    versions: {},
  });

  it("redeploys prodcheck after the run stage and before the tests, runs check-login after them, and records its results; prodcheck is never removed", async () => {
    const events: string[] = [];
    const h = harness({
      catalogue,
      cloud: {
        deploy: (stage) => (events.push(`deploy ${stage}`), Promise.resolve({ baseUrl: `https://reference-${stage}.owner-sub.workers.dev`, output: `deployed ${stage}` })),
        remove: (stage) => (events.push(`remove ${stage}`), Promise.resolve("removed")),
        checkLogin: (stage) => (
          events.push(`check-login ${stage}`),
          Promise.resolve({ status: 0, output: "check-login passed", record: checkLoginRecord([{ id: "PWD-AC-009", status: "passed" }, { id: "AUTH-AC-011", status: "passed" }, { id: "E2E-008", status: "passed" }]) })
        ),
      },
    });
    const run = h.deps.run;
    const deps: DriverDeps = { ...h.deps, run: (c) => (events.push(`run ${c.args[0] ?? c.command}`), run(c)) };
    const result = await runCompliance(parseArgs(["--target", "cloudflare"]), [], deps);
    expect(events.filter((e) => !e.startsWith("run run"))).toEqual([
      "deploy test-abcdefghij12345",
      "deploy test-abcdefghij12345",
      "deploy prodcheck",
      "run vitest",
      "run playwright",
      "check-login prodcheck",
      "remove test-abcdefghij12345",
    ]);
    expect(result.exitStatus).toBe(0);
    const results = recordOf(h).results;
    for (const id of ["PWD-AC-009", "AUTH-AC-011", "E2E-008"]) expect(results.filter((r) => r.id === id), id).toEqual([{ id, status: "passed" }]);
    expect(h.written[0]?.raw?.["prodcheck-deploy.log"]).toBe("deployed prodcheck");
    expect(h.written[0]?.raw?.["check-login.log"]).toBe("check-login passed");
    expect(h.events).not.toContain("pending+ prodcheck");
  });

  it("a failed step is failed with check-login's detail, a check it did not reach is not-run, and the run exits non-zero", async () => {
    const h = harness({
      catalogue,
      cloud: {
        checkLogin: () =>
          Promise.resolve({
            status: 1,
            output: "check-login failed",
            record: checkLoginRecord([
              { id: "PWD-AC-009", status: "failed", detail: "step 1: sign-up with a forged host: expected 200, got status 500" },
              { id: "AUTH-AC-011", status: "not-run", detail: "check-login stopped before its checks" },
              { id: "E2E-008", status: "failed", detail: "step 1: sign-up with a forged host: expected 200, got status 500" },
            ]),
          }),
      },
    });
    const result = await runCompliance(parseArgs(["--target", "cloudflare"]), [], h.deps);
    expect(result.exitStatus).toBe(1);
    const byId = (id: string) => recordOf(h).results.filter((r) => r.id === id);
    expect(byId("PWD-AC-009")).toEqual([{ id: "PWD-AC-009", status: "failed", detail: expect.stringMatching(/check-login failed: step 1: sign-up with a forged host.*\(record cl1\)/) }]);
    expect(byId("AUTH-AC-011")).toEqual([{ id: "AUTH-AC-011", status: "not-run", detail: "check-login stopped before its checks" }]);
  });

  it("when prodcheck cannot be redeployed, check-login is not run and its criteria are failed naming why; the first deploy's unset apiKey is set first", async () => {
    const events: string[] = [];
    let prodDeploys = 0;
    const h = harness({
      catalogue,
      cloud: {
        deploy: (stage) => {
          events.push(`deploy ${stage}`);
          if (stage !== "prodcheck") return Promise.resolve({ baseUrl: "https://reference-test.owner-sub.workers.dev", output: "ok" });
          prodDeploys += 1;
          return prodDeploys === 1 ? Promise.reject(new SecretsNotSetError("required secrets are not set: apiKey", "first prodcheck output")) : Promise.reject(new Error("deploy --target cloudflare --stage prodcheck failed with status 1"));
        },
        setSecret: (stage, name) => (events.push(`secret ${name} ${stage}`), Promise.resolve("set")),
        checkLogin: () => (events.push("check-login"), Promise.resolve({ status: 0, output: "" })),
      },
    });
    const result = await runCompliance(parseArgs(["--target", "cloudflare"]), [], h.deps);
    expect(events).toEqual(["deploy test-abcdefghij12345", "secret apiKey test-abcdefghij12345", "deploy test-abcdefghij12345", "deploy prodcheck", "secret apiKey prodcheck", "deploy prodcheck"]);
    expect(result.exitStatus).toBe(1);
    for (const id of ["PWD-AC-009", "AUTH-AC-011", "E2E-008"]) {
      expect(recordOf(h).results.filter((r) => r.id === id), id).toEqual([{ id, status: "failed", detail: expect.stringContaining("not checked: redeploying prodcheck failed: deploy --target cloudflare --stage prodcheck failed with status 1") }]);
    }
    expect(h.written[0]?.redactions).toContainEqual({ value: SECRET, replacement: "<test-secret>" });
  });

  it("local runs, milestone runs and runs selecting no prodcheck criterion never touch prodcheck", async () => {
    for (const argv of [["--target", "local"], ["--target", "cloudflare", "--milestone"], ["--target", "cloudflare", "--only", "KV-AC-001"]]) {
      const events: string[] = [];
      const h = harness({
        catalogue: [...catalogue, entry("PROV-AC-003", "Cloud (milestone)")],
        cloud: { deploy: (stage) => (events.push(`deploy ${stage}`), Promise.resolve({ baseUrl: "https://reference-test.owner-sub.workers.dev", output: "ok" })), checkLogin: () => (events.push("check-login"), Promise.resolve({ status: 0, output: "" })) },
      });
      await runCompliance(parseArgs(argv), argv, h.deps);
      expect(events.filter((e) => e.includes("prodcheck") || e === "check-login"), argv.join(" ")).toEqual([]);
    }
  });
});
