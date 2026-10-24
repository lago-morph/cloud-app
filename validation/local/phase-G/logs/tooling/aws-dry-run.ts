/**
 * G-RUN: dry run of `compliance --target aws` against fakes (plan-aws.md G-RUN; DEC-0498, DEC-0501).
 * The real driver (`runCompliance`) and the real `nodeDeps`, with only these replaced:
 *   - `cloud("aws")`: `cliStageOps` with a fake framework-CLI runner (deploy / secrets set / remove
 *     answer from here, never spawned) and a fake `OperationsFactory` for the leftover check;
 *     `testStageClusters` and `apiCalls` answer from here instead of the G-T1 AWS hooks;
 *   - `notRunRules`: `PHASE_RULES` without the `*`/aws "AWS live run pending (no account)" rule;
 *   - `pendingStages`: a scratch file, not the repository's `.framework/compliance` one.
 * The test runners (vitest, playwright), the build and the typecheck are the real ones.
 * Run under `unshare -rn` (loopback only), with no AWS_* credentials or region in the environment.
 */
import { join } from "node:path";
import { parseArgs } from "/home/user/cloud-app/.claude/worktrees/agent-aa2e78cb332fe6259/tests/compliance/harness/args.js";
import { runCompliance, type RunCall } from "/home/user/cloud-app/.claude/worktrees/agent-aa2e78cb332fe6259/tests/compliance/harness/driver.js";
import { PHASE_RULES } from "/home/user/cloud-app/.claude/worktrees/agent-aa2e78cb332fe6259/tests/compliance/harness/expected.js";
import { cliStageOps, nodeDeps, pendingStageStore, type OperationsFactory } from "/home/user/cloud-app/.claude/worktrees/agent-aa2e78cb332fe6259/tests/compliance/harness/node-deps.js";

const repoRoot = process.env.COMPLIANCE_REPO_ROOT ?? process.cwd();
const scratch = process.env.GRUN_SCRATCH ?? "/tmp";
const argv = process.argv.slice(2);
const say = (line: string): void => void process.stdout.write(`[dry-run] ${line}\n`);

const FAKE_ORIGIN = "https://d111111abcdef8.cloudfront.net";
const fakeCli = (call: RunCall): Promise<{ status: number; output: string }> => {
  const args = call.args.slice(1); // after "prototype-framework"
  say(`fake framework CLI: ${call.command} ${call.args.join(" ")} (cwd ${call.cwd})${call.input === undefined ? "" : " <value on stdin, not shown>"}`);
  if (args[0] === "deploy") return Promise.resolve({ status: 0, output: `fake deploy of ${args.join(" ")}\nurl: ${FAKE_ORIGIN}\n` });
  if (args[0] === "secrets") return Promise.resolve({ status: 0, output: `fake: set secret ${String(args[2])} on ${args.slice(3).join(" ")}\n` });
  if (args[0] === "remove") return Promise.resolve({ status: 0, output: `fake remove of ${args.join(" ")}\n` });
  return Promise.resolve({ status: 1, output: `fake CLI: unexpected command ${args.join(" ")}\n` });
};
const fakeOperations: OperationsFactory = (options) => (input) => {
  say(`fake OperationsFactory: requireCredentials=${String(options.requireCredentials)} app=${input.appDir.slice(repoRoot.length + 1)} target=${input.target}`);
  return {
    listStageResources: (stage) => {
      say(`fake listStageResources(${JSON.stringify(stage)}) -> no resources`);
      return Promise.resolve({ databases: [], resources: [] });
    },
  } as ReturnType<ReturnType<OperationsFactory>>;
};

const base = nodeDeps(repoRoot);
const deps = {
  ...base,
  notRunRules: PHASE_RULES.filter((r) => !(r.id === "*" && r.targets.includes("aws"))),
  pendingStages: pendingStageStore(join(scratch, "pending-stages.json")),
  cloud: (target: Parameters<typeof base.cloud>[0]) => {
    if (target !== "aws") throw new Error(`dry run is for --target aws only, not ${target}`);
    const ops = cliStageOps(repoRoot, "aws", { run: fakeCli, operations: fakeOperations, env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
    return {
      ...ops,
      testStageClusters: () => (say("fake testStageClusters() -> []"), Promise.resolve([])),
      apiCalls: () => 0,
    };
  },
};

say(`argv: ${argv.join(" ")}`);
const result = await runCompliance(parseArgs(argv), argv, deps);
say(`exit status ${String(result.exitStatus)}; record ${result.recordPath ?? "(none)"}`);
process.exit(result.exitStatus);
