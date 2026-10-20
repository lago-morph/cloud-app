/**
 * `deploy --target <t> --stage <s>` (CLI-REQ-001; PROV-REQ-002; D-05).
 *
 * 1. Options: a cloud target (local has `dev`) and a stage; the runner-only abort point comes
 *    from the environment variable `PROTOTYPE_FRAMEWORK_ABORT_AT` (`after-copy` | `after-code`,
 *    DEC-0269), which only the compliance runner sets, so it never appears among the owner's
 *    options.
 * 2. The process must be able to reach the cloud (`NODE_USE_ENV_PROXY=1` behind a proxy).
 * 3. `prepare`: build the deployment (`build --target <t> --stage <s>`, plus the client's static
 *    assets) and read what the core needs from the app: the migration histories, the declared
 *    secrets, the stage's Google client ID. Only local files are written.
 * 4. The target-neutral PROV core (`runDeploy`, steps 1–7) on the target's operations. It never
 *    creates the account's shared resources: only `setup-account` does (PROV-REQ-004).
 * 5. On success: record the stage's public origin for `smoke` (`recordDeployOutput`, DEC-0272)
 *    and, for a production stage, print the Google callback URL to register (GOOGLE-REQ-004).
 * Exit 0 only when every step passed (CLI-REQ-003).
 */
import type { Target } from "../../core/identity.js";
import type { Histories } from "../../mig/apply.js";
import { runDeploy, type AbortPoint } from "../../provision/core/deploy.js";
import type { TargetOperations } from "../../provision/core/operations.js";
import { parseTargetStage, UsageError } from "../args.js";
import { describeFailure } from "../failure.js";
import { EXIT, type CliIo, type Command } from "../io.js";
import { cloudProcessProblems, type ProcessEnvironment } from "./smoke-cloud.js";

/** The runner-only abort point's variable (compliance.md §2 "Deploy recovery"; DEC-0269). */
export const ABORT_AT_VARIABLE = "PROTOTYPE_FRAMEWORK_ABORT_AT";
const ABORT_POINTS: readonly AbortPoint[] = ["after-copy", "after-code"];

/** What `prepare` reads and builds for one deploy. */
export interface PreparedDeploy {
  /** The app's name (`defineApp`). */
  readonly app: string;
  readonly migrations: Histories;
  /** The app's declared secret names. */
  readonly requiredSecrets: readonly string[];
  /** The stage's `framework.google.clientId`, if configured. */
  readonly googleClientId?: string;
  /** The built code, handed to the target's operations as is. */
  readonly code: unknown;
}

export interface DeployDeps {
  readonly env: ProcessEnvironment;
  prepare(appDir: string, target: Target, stage: string): Promise<PreparedDeploy>;
  operations(input: { readonly appDir: string; readonly target: Target; readonly code?: unknown }): TargetOperations;
  recordDeployOutput(appDir: string, target: Target, stage: string, publicOrigin: string): void;
}

/** Parses `--target <cloud> --stage <s>`; `local` is refused (shared by deploy, remove, secrets). */
export function parseCloudTargetStage(command: string, args: readonly string[]): { readonly target: Target; readonly stage: string } {
  const parsed = parseTargetStage(args);
  if (parsed.target === "local") throw new UsageError(`${command} works on cloud targets; locally the app runs with dev (npm run dev)`);
  return parsed;
}

/** Prints the process problems of a cloud command and returns 1, or returns undefined when there are none. */
export function refuseUnreachableCloud(command: string, env: ProcessEnvironment, io: Pick<CliIo, "stderr">): number | undefined {
  const problems = cloudProcessProblems(env);
  if (problems.length === 0) return undefined;
  io.stderr(`${command} failed: ${problems.join("; ")}\n`);
  return EXIT.failed;
}

function abortPoint(env: ProcessEnvironment): AbortPoint | undefined {
  const value = env[ABORT_AT_VARIABLE];
  if (value === undefined || value === "") return undefined;
  if (!(ABORT_POINTS as readonly string[]).includes(value)) throw new UsageError(`${ABORT_AT_VARIABLE} must be one of: ${ABORT_POINTS.join(", ")} (it is set only by the compliance runner)`);
  return value as AbortPoint;
}

export function deployCommand(deps: DeployDeps): Command {
  return async (args, io) => {
    const { target, stage } = parseCloudTargetStage("deploy", args);
    const abortAt = abortPoint(deps.env);
    const refused = refuseUnreachableCloud("deploy", deps.env, io);
    if (refused !== undefined) return refused;

    let prepared: PreparedDeploy;
    try {
      prepared = await deps.prepare(io.cwd, target, stage);
    } catch (error) {
      io.stderr(`deploy failed before step 1 (building the deployment): ${describeFailure(error)}\n  stage state: nothing was created or changed\n  next action: fix the problem and run deploy again\n`);
      return EXIT.failed;
    }

    const ops = deps.operations({ appDir: io.cwd, target, code: prepared.code });
    const result = await runDeploy(
      ops,
      {
        stage: { app: prepared.app, stage },
        migrations: prepared.migrations,
        requiredSecrets: prepared.requiredSecrets,
        ...(prepared.googleClientId === undefined ? {} : { googleClientId: prepared.googleClientId }),
        ...(abortAt === undefined ? {} : { abortAt }),
      },
      io,
    );
    if (result.status !== EXIT.ok || result.publicOrigin === undefined) return EXIT.failed;

    deps.recordDeployOutput(io.cwd, target, stage, result.publicOrigin);
    if (!stage.startsWith("test-")) io.stdout(`Google callback URL to register: ${result.publicOrigin}/api/auth/callback\n`);
    return EXIT.ok;
  };
}
