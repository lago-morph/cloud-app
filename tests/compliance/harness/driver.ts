/**
 * The compliance driver (COMPL-REQ-001…004): one command runs the tagged integration and E2E
 * tests that apply to a target and tier, and writes one evidence record with the raw output.
 * It records; it does not judge (prompt §7): only the evaluator's verdict counts as a pass.
 *
 * Cloud usage (plan "Cloud usage limits"): the driver selects only the tests tagged with an
 * expected ID (`-t` / `--grep`), runs each selected test layer once (selection.ts: on local
 * also the unit layer, for the unit-level IDs only), generates no data, and on a cloud target
 * uses one test stage for the whole run.
 */
import {
  DirtyTreeError,
  assertCleanTree,
  testStageName,
  type EvidencePaths,
  type EvidenceRecord,
  type EvidenceResult,
  type GitState,
  type Redaction,
  type WriteEvidenceInput,
  redact,
} from "../../../packages/framework/src/evidence/public.js";
import { ALL, type ComplianceArgs } from "./args.js";
import type { CatalogueEntry, Target } from "./catalogue.js";
import { childEnv } from "./env.js";
import { expectedCriteria, type ExpectedEntry } from "./expected.js";
import { assertTestStage } from "./leftovers.js";
import { grepPattern, parsePlaywrightJson, parseVitestJson } from "./reports.js";
import { criterionResults, type TestOutcome } from "./results.js";
import { idsFor, runnerSelection, scopeTests } from "./selection.js";

export interface RunCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  /** Text for the process's standard input (a secret value for `secrets set`; never an argument). */
  readonly input?: string;
  /** Values the live echo of the process's output must hide (the run's test secret). */
  readonly redact?: readonly string[];
}

/**
 * A deploy that stopped only because a required secret is unset: a stage's first Cloudflare
 * deploy stops after step 5 until `secrets set` (PROV §2 "First Cloudflare deploy", DEC-0277).
 */
export class SecretsNotSetError extends Error {
  constructor(
    message: string,
    readonly output: string,
  ) {
    super(message);
    this.name = "SecretsNotSetError";
  }
}

/** The reference app's test secret (DEC-0277), and how evidence shows it. */
export const TEST_SECRET = { name: "apiKey", replacement: "<test-secret>" } as const;

export interface LocalSession {
  readonly baseUrl: string;
  /** Stops the app; resolves to its captured output. */
  stop(): Promise<string>;
}

/** The per-target operations the driver needs on a cloud (PROV §2). */
export interface CloudStageOps {
  /** Rejects with `SecretsNotSetError` when the deploy stopped only on unset secrets. */
  deploy(stage: string): Promise<{ readonly baseUrl: string; readonly output: string }>;
  /**
   * `secrets set <name>` on the stage, the value on standard input; resolves to its output (never
   * the value). Needed only to deploy a run stage: cleanup-only operations may leave it out.
   */
  setSecret?(stage: string, name: string, value: string): Promise<string>;
  remove(stage: string): Promise<string>;
  /** The stage's resources that still exist, by exact identifier (PROV `listStageResources`). */
  listStageResources(stage: string): Promise<readonly string[]>;
}

export interface PendingStages {
  list(target: Target): readonly string[];
  add(target: Target, stage: string): void;
  remove(target: Target, stage: string): void;
}

export interface DriverDeps {
  readonly repoRoot: string;
  readonly git: GitState;
  catalogue(): readonly CatalogueEntry[];
  newRunId(): string;
  /** A fresh random value for the run stage's test secret (letters and digits, ≥ 12; DEC-0277). */
  newTestSecret(): string;
  now(): Date;
  versions(): Record<string, string>;
  tempDir(): string;
  readFile(path: string): string | undefined;
  run(call: RunCall): Promise<{ readonly status: number; readonly output: string }>;
  startLocal(): Promise<LocalSession>;
  cloud(target: Target): CloudStageOps;
  readonly pendingStages: PendingStages;
  writeEvidence(input: WriteEvidenceInput): EvidencePaths;
  log(line: string): void;
}

export interface DriverResult {
  readonly exitStatus: number;
  readonly recordPath?: string;
}

const SELF_TEST_ID = "COMPL-AC-003";

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0] ?? text;
}

function select(args: ComplianceArgs, deps: DriverDeps): ExpectedEntry[] {
  if (args.selfTest) return [{ id: SELF_TEST_ID, run: true, parts: [""], notRunParts: [] }];
  const expected = expectedCriteria(deps.catalogue(), args.target, args.milestone ? "milestone" : "automated").sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ids = new Set(expected.map((e) => e.id));
  for (const id of [...(args.only ?? []), ...[...args.blocked.keys()].filter((k) => k !== ALL)]) {
    if (!ids.has(id)) deps.log(`compliance: note: ${id} is not expected on ${args.target} in this tier; ignored`);
  }
  const only = args.only === undefined ? undefined : new Set(args.only);
  return expected.map((e) => (e.run && only !== undefined && !only.has(e.id) ? { ...e, run: false, notRun: "not selected for this run (--only)", notRunParts: [] } : e));
}

/** The operator's `--blocked` list with `*` expanded to every criterion the run would execute. */
function expandBlocked(given: ReadonlyMap<string, string>, expected: readonly ExpectedEntry[]): ReadonlyMap<string, string> {
  const all = given.get(ALL);
  if (all === undefined) return given;
  const out = new Map(expected.filter((e) => e.run).map((e) => [e.id, all]));
  for (const [id, reason] of given) if (id !== ALL) out.set(id, reason);
  return out;
}

function subdomainRedaction(baseUrl: string): Redaction[] {
  const match = /^https:\/\/[^./]+\.([^./]+)\.workers\.dev(?:[/:]|$)/.exec(baseUrl);
  return match?.[1] === undefined ? [] : [{ value: match[1], replacement: "<account-subdomain>" }];
}

export async function runCompliance(args: ComplianceArgs, argv: readonly string[], deps: DriverDeps): Promise<DriverResult> {
  const commit = deps.git.commit();
  try {
    assertCleanTree(deps.git, commit);
  } catch (error) {
    if (!(error instanceof DirtyTreeError)) throw error;
    deps.log(`compliance: ${error.message}. Commit or revert the changes, then run again.`);
    return { exitStatus: 2 };
  }

  const startedAt = deps.now().toISOString();
  const runId = deps.newRunId();
  const isCloud = args.target !== "local";
  let expected = select(args, deps);
  const blocked = expandBlocked(args.blocked, expected);
  const toRun = expected.filter((e) => e.run && !blocked.has(e.id)).map((e) => e.id);
  const raw: Record<string, string> = { "expected.json": `${JSON.stringify(expected, null, 2)}\n` };
  const leftovers: string[] = [];
  const redactions: Redaction[] = [];
  let stage = isCloud ? args.stage : undefined;
  let exitStatus = 0;
  const outcomes: TestOutcome[] = [];
  const runErrors: string[] = [];
  let testSecret: string | undefined;
  // Nothing the driver prints carries a redacted value (the test secret, the account subdomain).
  const log = (line: string): void => deps.log(redact(line, redactions));

  /**
   * DEC-0277 on the run stage: deploy; set `apiKey` to a fresh value through `secrets set` (the
   * value on standard input, kept in memory only); deploy again, so the stage serves with it
   * (a first deploy stops on the unset secret with the app stopped). The tests get the value in
   * COMPLIANCE_SECRET_API_KEY; the evidence writer and the driver's output replace it.
   */
  const deployWithTestSecret = async (ops: CloudStageOps, name: string): Promise<string> => {
    try {
      raw["deploy.log"] = (await ops.deploy(name)).output;
    } catch (error) {
      if (!(error instanceof SecretsNotSetError)) throw error;
      raw["deploy.log"] = error.output;
    }
    const value = deps.newTestSecret();
    redactions.push({ value, replacement: TEST_SECRET.replacement });
    if (ops.setSecret === undefined) throw new Error(`the ${args.target} stage operations cannot set the test secret ${TEST_SECRET.name}`);
    raw["secrets-set.log"] = await ops.setSecret(name, TEST_SECRET.name, value);
    const result = await ops.deploy(name);
    raw["redeploy.log"] = result.output;
    testSecret = value;
    return result.baseUrl;
  };

  const checkLeftovers = async (ops: CloudStageOps, name: string): Promise<boolean> => {
    try {
      const left = await ops.listStageResources(name);
      leftovers.push(...left.map((r) => `${name}: ${r}`));
      return left.length === 0;
    } catch (error) {
      leftovers.push(`${name}: leftover check failed: ${firstLine(error)}`);
      return false;
    }
  };
  const removeStage = async (ops: CloudStageOps, name: string): Promise<void> => {
    try {
      assertTestStage(name);
    } catch (error) {
      log(`compliance: not removing ${name}: ${firstLine(error)}`);
      return;
    }
    try {
      raw[`remove-${name}.log`] = await ops.remove(name);
    } catch (error) {
      raw[`remove-${name}.log`] = `remove failed: ${error instanceof Error ? error.message : String(error)}\n`;
    }
    if (await checkLeftovers(ops, name)) {
      try {
        deps.pendingStages.remove(args.target, name);
      } catch (error) {
        raw["pending-stages.log"] = `${raw["pending-stages.log"] ?? ""}${name}: could not update the pending-stage list: ${error instanceof Error ? error.message : String(error)}\n`;
        log(`compliance: ${name} was removed, but the pending-stage list could not be updated: ${firstLine(error)} (raw/pending-stages.log)`);
        exitStatus ||= 1;
      }
    }
  };

  if (toRun.length > 0) {
    let local: LocalSession | undefined;
    let ops: CloudStageOps | undefined;
    let deployed = false;
    let baseUrl = args.baseUrl;
    try {
      if (!args.selfTest) {
        // The CLI that starts `dev` or deploys runs from the built framework, so build first.
        const toolEnv = childEnv(process.env, { target: args.target, runId });
        const build = await deps.run({ command: "npm", args: ["run", "build", "-w", "packages/framework"], cwd: deps.repoRoot, env: toolEnv });
        raw["build.log"] = build.output;
        if (build.status !== 0) throw new Error(`framework build failed with status ${String(build.status)}`);
        // Evidence for assertions only the compiler checks (expectTypeOf, @ts-expect-error; B-EV F7).
        const typecheck = await deps.run({ command: "npm", args: ["run", "typecheck"], cwd: deps.repoRoot, env: toolEnv });
        raw["typecheck.log"] = typecheck.output;
        if (typecheck.status !== 0) log(`compliance: npm run typecheck failed with status ${String(typecheck.status)} (raw/typecheck.log)`);
        exitStatus ||= typecheck.status;
      }
      if (isCloud) {
        ops = deps.cloud(args.target);
        // An interrupted earlier run left these stages: remove them first (COMPL-REQ-004).
        for (const old of deps.pendingStages.list(args.target)) await removeStage(ops, old);
        if (baseUrl === undefined) {
          stage ??= testStageName(runId);
          deps.pendingStages.add(args.target, stage);
          deployed = true;
          baseUrl = await deployWithTestSecret(ops, stage);
        }
        if (baseUrl !== undefined) redactions.push(...subdomainRedaction(baseUrl));
      } else if (!args.selfTest && baseUrl === undefined) {
        local = await deps.startLocal();
        baseUrl = local.baseUrl;
      }

      const env = childEnv(process.env, {
        target: args.target,
        runId,
        ...(stage === undefined ? {} : { stage }),
        ...(baseUrl === undefined ? {} : { baseUrl }),
        ...(testSecret === undefined ? {} : { testSecret }),
      });
      const hide = testSecret === undefined ? {} : { redact: [testSecret] };
      const tmp = deps.tempDir();
      for (const selection of runnerSelection({ target: args.target, selfTest: args.selfTest })) {
        const ids = idsFor(selection, toRun);
        if (ids.length === 0) continue;
        const pattern = grepPattern(ids);
        const jsonPath = `${tmp}/${selection.label}.json`;
        const result =
          selection.runner === "vitest"
            ? await deps.run({ command: "npx", args: [...selection.args, "-t", pattern, "--passWithNoTests", "--reporter=default", "--reporter=json", `--outputFile.json=${jsonPath}`], cwd: deps.repoRoot, env, ...hide })
            : await deps.run({ command: "npx", args: [...selection.args, "--grep", pattern, "--reporter=json", "--pass-with-no-tests"], cwd: deps.repoRoot, env: { ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonPath }, ...hide });
        raw[`${selection.label}.log`] = result.output;
        const text = deps.readFile(jsonPath) ?? "";
        raw[`${selection.label}.json`] = text;
        const parsed = selection.runner === "vitest" ? parseVitestJson(text, deps.repoRoot) : parsePlaywrightJson(text, "");
        // A unit-layer test evidences only the unit-level IDs its title carries (plan §10.3).
        outcomes.push(...scopeTests(selection, parsed.outcomes));
        runErrors.push(...parsed.errors);
        exitStatus ||= result.status;
      }
    } catch (error) {
      const reason = `not run: setting up the target failed: ${firstLine(error)}`;
      log(`compliance: ${reason}`);
      raw["driver-error.log"] = `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`;
      if (outcomes.length === 0) expected = expected.map((e) => (e.run && !blocked.has(e.id) ? { ...e, run: false, notRun: reason, notRunParts: [] } : e));
      exitStatus ||= 1;
    } finally {
      if (local !== undefined) {
        try {
          raw["dev.log"] = await local.stop();
        } catch (error) {
          raw["dev.log"] = `dev stop failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`;
          log(`compliance: stopping dev failed: ${firstLine(error)} (raw/dev.log)`);
          exitStatus ||= 1;
        }
      }
      if (ops !== undefined && deployed && stage !== undefined) await removeStage(ops, stage);
    }
  }
  // A stage that could not be removed, or a leftover check that could not run, is a partial failure (CLI-REQ-003).
  if (leftovers.length > 0) exitStatus ||= 1;
  if (runErrors.length > 0) raw["run-errors.log"] = `${runErrors.join("\n")}\n`;

  const results: EvidenceResult[] = criterionResults({ target: args.target, expected, outcomes, blocked });
  const record: EvidenceRecord = {
    runId,
    commit,
    target: args.target,
    ...(stage === undefined ? {} : { stage }),
    command: `npm run compliance -- ${argv.join(" ")}`.trimEnd(),
    startedAt,
    finishedAt: deps.now().toISOString(),
    exitStatus,
    results,
    versions: deps.versions(),
    ...(isCloud ? { leftovers } : {}),
  };
  try {
    const paths = deps.writeEvidence({ root: args.out ?? deps.repoRoot, git: deps.git, record, raw, redactions });
    const counts = new Map<string, number>();
    for (const r of results) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    log(`compliance: ${[...counts].map(([s, n]) => `${String(n)} ${s}`).join(", ")}; evidence ${paths.recordPath}`);
    if (leftovers.length > 0) log(`compliance: leftovers: ${leftovers.join("; ")}`);
    return { exitStatus, recordPath: paths.recordPath };
  } catch (error) {
    if (!(error instanceof DirtyTreeError)) throw error;
    log(`compliance: ${error.message}`);
    return { exitStatus: 2 };
  }
}
