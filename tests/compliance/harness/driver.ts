/**
 * The compliance driver (COMPL-REQ-001…004): one command runs the tagged integration and E2E
 * tests that apply to a target and tier, and writes one evidence record with the raw output.
 * It records; it does not judge (prompt §7): only the evaluator's verdict counts as a pass.
 *
 * Cloud usage (plan "Cloud usage limits"): the driver selects only the tests tagged with an
 * expected ID (`-t` / `--grep`), runs each selected test layer once (selection.ts: on local
 * also the unit layer, for the unit-level IDs only), generates no data, and on a cloud target
 * uses one test stage for the whole run. Release 1 targets local and Cloudflare; the AWS usage
 * caps and region step are on branch `aws` (DEC-0508).
 *
 * Cloud account (DEC-0530, DEC-0531): at the start of a cloud run the driver reads the account's
 * plan and D1 budget and creates the restricted test tokens the selected clauses need
 * (`DriverDeps.cloudAccount`, test-tokens.ts); at the end it deletes them, also after a failure,
 * and reports every `prototype-compliance-*` token still listed as a leftover. The cloud test
 * hooks' R2 tokens (`compliance-r2read-*`, `compliance-r2scoped-*`, named with the run ID) are
 * swept at the start and the end (`hookTokensToDelete`: expired or over an hour old, and at the
 * end every one of this run), and any still listed after that is a leftover too.
 *
 * A run against fakes (overridden not-run rules, or stage operations that say they are fakes) is
 * marked `dryRun` in its record, which no report counts (G-EV F3).
 *
 * Production checks (COMPL-REQ-005, prodcheck.ts): on an automated cloud run that selects a
 * criterion with a part on `prodcheck`, the driver redeploys `prodcheck` before the test layers
 * (never removing it), and runs `check-login` on it after them, folding its record's results in.
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
import { NOT_SELECTED, type CatalogueEntry, type ReleaseTarget as Target } from "./catalogue.js";
import { childEnv } from "./env.js";
import { expectedCriteria, PHASE_RULES, type ExpectedEntry, type NotRunRule } from "./expected.js";
import { assertTestStage } from "./leftovers.js";
import { CHECK_LOGIN_IDS, checkLoginOutcomes, PRODCHECK_IDS, PRODCHECK_STAGE } from "./prodcheck.js";
import { grepPattern, parsePlaywrightJson, parseVitestJson } from "./reports.js";
import { criterionResults, type TestOutcome } from "./results.js";
import { idsFor, runnerSelection, scopeTests } from "./selection.js";
import { d1Budget, describeBudget, RUN_PLAN_ENV, type D1Plan } from "./d1-budget.js";
import { hookTokensToDelete, RESTRICTED_TOKENS, staleTestTokens, type CloudAccountOps, type CreatedToken, type ListedTestToken } from "./test-tokens.js";

/** The start of every record command the driver writes (`npm run compliance -- <argv>`). */
const DRIVER_COMMAND_PREFIX = "npm run compliance --";

/** True when an evidence record's command is one the compliance driver writes (not, for example, `check-login`'s). */
export function isDriverCommand(command: string | undefined): boolean {
  return command !== undefined && (command === DRIVER_COMMAND_PREFIX || command.startsWith(`${DRIVER_COMMAND_PREFIX} `));
}

/** How evidence and the driver's output show a self-created test token's value (DEC-0531). */
export const TEST_TOKEN_REPLACEMENT = "<test-token>";

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

/** The skip-notes reporter (a skipped test's note reaches the JSON report), relative to the repository root. */
export const SKIP_NOTES_REPORTER = "./tests/compliance/harness/skip-notes-reporter.ts";

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
  /**
   * The account's criterion production stages (reserved prefixes, DEC-0560; `criterion-stages.ts`
   * `classifyCriterionStages`): `stale` are marked by a test and older than PAR-286, which the
   * driver removes at the start and the end of every cloud run like `test-` stages; `unmarked`
   * have the reserved shape but no marker (never removed, only warned about). Absent: none.
   */
  criterionStages?(): Promise<{ readonly stale: readonly string[]; readonly unmarked: readonly string[] }>;
  /** Deletes a criterion production stage's marker after its removal left nothing (DEC-0560). */
  forgetCriterionStage?(stage: string): Promise<void>;
  /**
   * `check-login --target <cloud> --stage <stage>` (PWD §2): its status, output and the evidence
   * record it wrote, if any. Absent: the run records the check-login IDs as failed.
   */
  checkLogin?(stage: string): Promise<{ readonly status: number; readonly output: string; readonly record?: EvidenceRecord }>;
  /** Set when these operations are fakes (G-RUN's dry run): what is faked. The record is then marked `dryRun`. */
  readonly dryRun?: string;
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
  /**
   * The cloud account's reads and the self-created test tokens (d1-budget.ts, test-tokens.ts;
   * DEC-0530, DEC-0531). Absent: no plan is read (the tests apply the setting or the Free
   * budget), no test token is created and no token leftover check runs.
   */
  cloudAccount?(target: Target): CloudAccountOps | undefined;
  readonly pendingStages: PendingStages;
  /** The not-run rules; default `PHASE_RULES`. Tests pass others (a run against fakes). */
  readonly notRunRules?: readonly NotRunRule[];
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
  const expected = expectedCriteria(deps.catalogue(), args.target, args.milestone ? "milestone" : "automated", deps.notRunRules ?? PHASE_RULES).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ids = new Set(expected.map((e) => e.id));
  for (const id of [...(args.only ?? []), ...[...args.blocked.keys()].filter((k) => k !== ALL)]) {
    if (!ids.has(id)) deps.log(`compliance: note: ${id} is not expected on ${args.target} in this tier; ignored`);
  }
  const only = args.only === undefined ? undefined : new Set(args.only);
  return expected.map((e) => (e.run && only !== undefined && !only.has(e.id) ? { ...e, run: false, notRun: NOT_SELECTED, notRunParts: [] } : e));
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

  /**
   * DEC-0560: criterion production stages are cleaned like `test-` stages, but only those a test
   * marked and whose marker is stale (older than PAR-286), so a concurrent run's live stage is
   * never touched. Each is removed (`--confirm-production`, by the target's `remove`); its
   * leftovers are recorded, and when none remain its marker is deleted. A stage of the reserved
   * shape without a marker (an owner's) is only warned about. A listing that fails is a leftover entry.
   */
  const removeCriterionStages = async (ops: CloudStageOps, when: "start" | "end"): Promise<void> => {
    if (ops.criterionStages === undefined) return;
    let found: { readonly stale: readonly string[]; readonly unmarked: readonly string[] };
    try {
      found = await ops.criterionStages();
    } catch (error) {
      leftovers.push(`criterion production stage check failed: ${firstLine(error)}`);
      return;
    }
    for (const name of found.unmarked) log(`compliance: warning: ${name} has the shape of a criterion production stage but no marker; it is not removed (DEC-0560)`);
    for (const name of found.stale) {
      log(`compliance: removing the stale criterion production stage ${name} (${when} of run)`);
      const before = leftovers.length;
      await removeStage(ops, name);
      if (leftovers.length !== before || ops.forgetCriterionStage === undefined) continue;
      try {
        await ops.forgetCriterionStage(name);
      } catch (error) {
        leftovers.push(`${name}: its criterion stage marker could not be deleted: ${firstLine(error)}`);
      }
    }
  };

  /**
   * COMPL-REQ-005: `prodcheck` is redeployed (a production stage: never removed, no pending
   * entry). Its first deploy stops on the reference app's unset `apiKey`, which is then set to a
   * fresh value (on standard input, redacted) before the second deploy. Resolves to the problem, or undefined.
   */
  const redeployProdcheck = async (cloudOps: CloudStageOps): Promise<string | undefined> => {
    try {
      try {
        raw["prodcheck-deploy.log"] = (await cloudOps.deploy(PRODCHECK_STAGE)).output;
        return undefined;
      } catch (error) {
        if (!(error instanceof SecretsNotSetError) || cloudOps.setSecret === undefined) throw error;
        raw["prodcheck-deploy.log"] = error.output;
      }
      const value = deps.newTestSecret();
      redactions.push({ value, replacement: TEST_SECRET.replacement });
      raw["prodcheck-secrets-set.log"] = await (cloudOps.setSecret as NonNullable<CloudStageOps["setSecret"]>)(PRODCHECK_STAGE, TEST_SECRET.name, value);
      raw["prodcheck-redeploy.log"] = (await cloudOps.deploy(PRODCHECK_STAGE)).output;
      return undefined;
    } catch (error) {
      raw["prodcheck-deploy-error.log"] = `${error instanceof Error ? error.message : String(error)}\n`;
      return `redeploying ${PRODCHECK_STAGE} failed: ${firstLine(error)}`;
    }
  };
  const prodcheckRun = isCloud && !args.selfTest && !args.milestone && toRun.some((id) => PRODCHECK_IDS.includes(id));
  const checkLoginRun = prodcheckRun ? toRun.filter((id) => CHECK_LOGIN_IDS.includes(id)) : [];
  let prodcheckProblem: string | undefined;

  let ops: CloudStageOps | undefined;
  let account: CloudAccountOps | undefined;
  let runPlan: D1Plan | undefined;
  const createdTokens: CreatedToken[] = [];
  /** The self-created test tokens' variables for the test processes (values in memory only). */
  const tokenEnv: Record<string, string> = {};
  /**
   * DEC-0530/DEC-0531 at the start of a cloud run: read the plan's D1 budget, delete test tokens an
   * interrupted earlier run left, and create each restricted token a selected clause needs and
   * the operator did not supply. A token's value goes only into `tokenEnv` and the redactions.
   */
  /**
   * Deletes the hooks' R2 test tokens (`compliance-r2read-*`, `compliance-r2scoped-*`) that no live
   * process holds: expired or over an hour old, and at the end of the run also every one named
   * with this run's ID (its test processes have all ended). Resolves to the IDs deleted; a failed
   * deletion is logged (the token then stays listed and is a leftover).
   */
  const deleteHookTokens = async (acc: CloudAccountOps, listed: readonly ListedTestToken[], when: "start" | "end"): Promise<Set<string>> => {
    const deleted = new Set<string>();
    for (const t of hookTokensToDelete(listed, deps.now(), when === "end" ? runId : undefined)) {
      try {
        await acc.deleteToken(t.id);
        deleted.add(t.id);
        log(`compliance: deleted the R2 test token ${t.name} (${when} of run)`);
      } catch (error) {
        log(`compliance: deleting the R2 test token ${t.name} failed: ${firstLine(error)}`);
      }
    }
    return deleted;
  };
  const prepareAccount = async (acc: CloudAccountOps): Promise<void> => {
    // Each step in its own try, so a failure in one (the plan read, a stale token's deletion) does
    // not skip the sweeps after it; the first failure then fails the setup.
    let failed: { readonly error: unknown } | undefined;
    try {
      const reading = await acc.d1Plan();
      runPlan = reading.plan;
      const budget = d1Budget(reading.plan);
      raw["d1-budget.json"] = `${JSON.stringify({ ...reading, budget }, null, 2)}\n`;
      log(`compliance: ${describeBudget(budget)} (plan from ${reading.source}: ${reading.detail})`);
    } catch (error) {
      failed ??= { error };
    }
    let listed: readonly ListedTestToken[] | undefined;
    try {
      listed = await acc.testTokens();
      // Only tokens an interrupted earlier run left (compliance.md §4): another run's tokens younger
      // than PAR-286 may be in use (a nested or concurrent run), and the current run's are its own.
      for (const old of staleTestTokens(listed, runId, deps.now())) {
        await acc.deleteToken(old.id);
        log(`compliance: deleted the test token ${old.name} an earlier run left`);
      }
    } catch (error) {
      failed ??= { error };
    }
    // The hooks' R2 tokens: expired or over an hour old (none of a live process; this run has none yet).
    if (listed !== undefined) {
      try {
        await deleteHookTokens(acc, listed, "start");
      } catch (error) {
        failed ??= { error };
      }
    }
    if (failed !== undefined) throw failed.error;
    for (const spec of RESTRICTED_TOKENS) {
      if (!toRun.includes(spec.criterion) || (process.env[spec.env] ?? "") !== "") continue;
      const token = await acc.createRestrictedToken(spec, runId);
      createdTokens.push(token);
      redactions.push({ value: token.value, replacement: TEST_TOKEN_REPLACEMENT });
      tokenEnv[spec.env] = token.value;
      log(`compliance: created the test token ${token.name} (lacks ${spec.omitted}) for ${spec.criterion}`);
    }
  };
  /**
   * Deletes this run's test tokens and the hooks' R2 tokens no live process holds, then reports
   * every `prototype-compliance-*` and hook R2 token still listed as a leftover.
   */
  const cleanUpTokens = async (acc: CloudAccountOps): Promise<void> => {
    for (const token of createdTokens) {
      try {
        await acc.deleteToken(token.id);
      } catch (error) {
        log(`compliance: deleting the test token ${token.name} failed: ${firstLine(error)}`);
      }
    }
    try {
      const listed = await acc.testTokens();
      const deleted = await deleteHookTokens(acc, listed, "end");
      leftovers.push(...listed.filter((t) => !deleted.has(t.id)).map((t) => `API token ${t.name}`));
    } catch (error) {
      leftovers.push(`test token check failed: ${firstLine(error)}`);
    }
  };
  if (toRun.length > 0) {
    let local: LocalSession | undefined;
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
        if (!args.selfTest) account = deps.cloudAccount?.(args.target);
        if (account !== undefined) await prepareAccount(account);
        // An interrupted earlier run left these stages: remove them first (COMPL-REQ-004).
        for (const old of deps.pendingStages.list(args.target)) await removeStage(ops, old);
        // Criterion production stages an interrupted test left (DEC-0560).
        await removeCriterionStages(ops, "start");
        if (baseUrl === undefined) {
          stage ??= testStageName(runId);
          deps.pendingStages.add(args.target, stage);
          deployed = true;
          baseUrl = await deployWithTestSecret(ops, stage);
        }
        if (baseUrl !== undefined) redactions.push(...subdomainRedaction(baseUrl));
        if (prodcheckRun) {
          prodcheckProblem = await redeployProdcheck(ops);
          if (prodcheckProblem !== undefined) {
            log(`compliance: ${prodcheckProblem} (raw/prodcheck-deploy-error.log)`);
            exitStatus ||= 1;
          }
        }
      } else if (!args.selfTest && baseUrl === undefined) {
        local = await deps.startLocal();
        baseUrl = local.baseUrl;
      }

      const env = childEnv(process.env, {
        target: args.target,
        runId,
        mode: args.milestone ? "milestone" : "automated",
        ...(stage === undefined ? {} : { stage }),
        ...(baseUrl === undefined ? {} : { baseUrl }),
        ...(testSecret === undefined ? {} : { testSecret }),
      });
      if (runPlan !== undefined) env[RUN_PLAN_ENV] = runPlan;
      Object.assign(env, tokenEnv);
      const hidden = [...(testSecret === undefined ? [] : [testSecret]), ...createdTokens.map((t) => t.value)];
      const hide = hidden.length === 0 ? {} : { redact: hidden };
      const tmp = deps.tempDir();
      for (const selection of runnerSelection({ target: args.target, selfTest: args.selfTest })) {
        const ids = idsFor(selection, toRun);
        if (ids.length === 0) continue;
        const pattern = grepPattern(ids);
        const jsonPath = `${tmp}/${selection.label}.json`;
        const result =
          selection.runner === "vitest"
            ? await deps.run({
                command: "npx",
                args: [...selection.args, "-t", pattern, "--passWithNoTests", "--reporter=default", `--reporter=${SKIP_NOTES_REPORTER}`, "--reporter=json", `--outputFile.json=${jsonPath}`],
                cwd: deps.repoRoot,
                env,
                ...hide,
              })
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
      // check-login last (prodcheck.ts): its sign-in burst rate-limits this client for PAR-258's window.
      if (checkLoginRun.length > 0 && ops !== undefined) {
        if (prodcheckProblem !== undefined) outcomes.push(...checkLoginOutcomes(checkLoginRun, { problem: `not checked: ${prodcheckProblem}` }));
        else if (ops.checkLogin === undefined) outcomes.push(...checkLoginOutcomes(checkLoginRun, { problem: `the ${args.target} stage operations cannot run check-login` }));
        else {
          try {
            const result = await ops.checkLogin(PRODCHECK_STAGE);
            raw["check-login.log"] = result.output;
            outcomes.push(...checkLoginOutcomes(checkLoginRun, result));
            exitStatus ||= result.status;
          } catch (error) {
            outcomes.push(...checkLoginOutcomes(checkLoginRun, { problem: `check-login could not run: ${firstLine(error)}` }));
            exitStatus ||= 1;
          }
        }
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
      if (ops !== undefined) await removeCriterionStages(ops, "end");
      // Also after a failed run: the run's test tokens go, and none may remain (DEC-0531).
      if (account !== undefined) await cleanUpTokens(account);
    }
  }
  // A stage that could not be removed, or a leftover check that could not run, is a partial failure (CLI-REQ-003).
  if (leftovers.length > 0) exitStatus ||= 1;
  if (runErrors.length > 0) raw["run-errors.log"] = `${runErrors.join("\n")}\n`;

  const results: EvidenceResult[] = criterionResults({ target: args.target, expected, outcomes, blocked });
  // G-EV F3: a run against fakes says so in its record; the reports never count it, wherever it is stored.
  const fakes = [...(deps.notRunRules !== undefined && deps.notRunRules !== PHASE_RULES ? ["not-run rules overridden (DriverDeps.notRunRules)"] : []), ...(ops?.dryRun === undefined ? [] : [ops.dryRun]), ...(account?.dryRun === undefined ? [] : [account.dryRun])];
  const dryRun = fakes.length === 0 ? undefined : fakes.join("; ");
  if (dryRun !== undefined) log(`compliance: dry run (${dryRun}): this record is not evidence`);
  const record: EvidenceRecord = {
    runId,
    commit,
    target: args.target,
    ...(stage === undefined ? {} : { stage }),
    command: `${DRIVER_COMMAND_PREFIX} ${argv.join(" ")}`.trimEnd(),
    startedAt,
    finishedAt: deps.now().toISOString(),
    exitStatus,
    results,
    versions: deps.versions(),
    ...(isCloud ? { leftovers } : {}),
    ...(dryRun === undefined ? {} : { dryRun }),
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
