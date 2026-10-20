/**
 * Further cloud test stages for C-T1 criteria that change a stage's state (secrets set and
 * deleted, stage removal) or deploy another app (the template, CLI-AC-005), so the run's shared
 * stage is never changed under the other criteria (compliance.md "Test stages": stage-lifecycle
 * criteria create and remove their own stages).
 *
 * Cloud usage (plan "Cloud usage limits"): one further stage at a time across all test files
 * (cross-process lock), removed in `finally`; no data is generated.
 */
import { newTestStage } from "../../../harness/index.js";
import { acquireLock, cli, scratchCopy, type CommandResult, type ScratchApp } from "./processes.js";
import { runDeployment } from "./repo.js";

export interface FurtherStage {
  readonly app: string;
  readonly stage: string;
  readonly target: string;
  readonly baseUrl: string;
  readonly copy: ScratchApp;
  /** Output of every CLI command run for this stage, in order (CLI-AC-004 scans it). */
  readonly outputs: CommandResult[];
  /** `secrets set <name>` with `value` on standard input. */
  setSecret(name: string, value: string): Promise<CommandResult>;
  /** Removes the stage (idempotent); resolves to the `remove` result. */
  remove(): Promise<CommandResult>;
}

/** The stage's public origin in `deploy` output (PROV-REQ-002 publishes it). */
function deployOrigin(output: string): string | undefined {
  return /(https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev)\b/.exec(output)?.[1];
}

/**
 * Deploys a scratch copy of `appDir` to a new `test-<random>` stage on the run's cloud with the
 * given secret values. On a stage's first Cloudflare deploy the secrets can be set only once the
 * Worker exists, so a deploy that stops naming unset secrets is followed by `secrets set` and a
 * second deploy (PROV §2 "First Cloudflare deploy").
 */
export async function withFurtherStage<T>(
  appDir: string,
  label: string,
  secrets: Readonly<Record<string, string>>,
  body: (stage: FurtherStage) => Promise<T>,
  options: { readonly git?: boolean } = {},
): Promise<T> {
  const run = runDeployment();
  if (!run.isCloud) throw new Error("further stages are for cloud targets only");
  const release = await acquireLock("further-stage", 60 * 60_000);
  const copy = await scratchCopy(appDir, label, options);
  const stageName = newTestStage();
  const outputs: CommandResult[] = [];
  const timeoutMs = 20 * 60_000;
  const runCli = async (args: string[], stdin?: string): Promise<CommandResult> => {
    const r = await cli(args, { cwd: copy.dir, timeoutMs, ...(stdin === undefined ? {} : { stdin }), env: { NODE_USE_ENV_PROXY: "1" } });
    outputs.push(r);
    return r;
  };
  let removed: CommandResult | undefined;
  const remove = async (): Promise<CommandResult> => {
    removed ??= await runCli(["remove", "--target", run.target, "--stage", stageName]);
    return removed;
  };
  const setSecret = (name: string, value: string): Promise<CommandResult> => runCli(["secrets", "set", name, "--target", run.target, "--stage", stageName], `${value}\n`);
  try {
    let deployed = await runCli(["deploy", "--target", run.target, "--stage", stageName]);
    if (deployed.status !== 0 && Object.keys(secrets).some((name) => deployed.output.includes(name))) {
      for (const [name, value] of Object.entries(secrets)) {
        const set = await setSecret(name, value);
        if (set.status !== 0) throw new Error(`secrets set ${name} on further stage ${stageName} failed with status ${String(set.status)}:\n${set.output.slice(-2000)}`);
      }
      deployed = await runCli(["deploy", "--target", run.target, "--stage", stageName]);
    }
    if (deployed.status !== 0) throw new Error(`deploy of a further stage ${stageName} failed with status ${String(deployed.status)}:\n${deployed.output.slice(-2000)}`);
    const baseUrl = deployOrigin(deployed.output);
    if (baseUrl === undefined) throw new Error(`deploy of further stage ${stageName} printed no workers.dev origin`);
    return await body({ app: label, stage: stageName, target: run.target, baseUrl, copy, outputs, setSecret, remove });
  } finally {
    const r = await remove();
    await copy.remove();
    await release();
    if (r.status !== 0) {
      // Leftovers are reported by the driver's leftover check only for the run stage; name these here.
      process.stderr.write(`[c-t1] removing further stage ${stageName} failed (status ${String(r.status)}); it may be left over:\n${r.output.slice(-2000)}\n`);
    }
  }
}
