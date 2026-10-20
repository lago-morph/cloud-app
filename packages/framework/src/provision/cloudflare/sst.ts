/**
 * The SST app of one Cloudflare stage, built from the app definition alone (PROV-REQ-001;
 * cloudflare.md §2; DEC-0036, DEC-0084, DEC-0087; DEC-PENDING-D-03-6). Apps contain no IaC:
 * the framework writes `sst.config.ts` into `<app>/.framework/provision/cloudflare/` on every
 * deploy and remove and runs SST there.
 *
 * The program declares:
 * - the stage's R2 bucket (`sst.cloudflare.Bucket`, fixed name `<app>-<stage>-files`);
 * - when a database is given, the stage's Worker (`sst.cloudflare.Worker`, fixed script name
 *   `<app>-<stage>`, `url: true` for its `workers.dev` route) running the framework's built
 *   bundle, with the static assets, the framework variables plus `FRAMEWORK_PUBLIC_ORIGIN`, and
 *   the bindings `DB` (the current D1 database, an input never in SST's state), `FILES` (the
 *   stage bucket) and the shared log bucket.
 * `removal: "remove"` so nothing is retained; `home: "cloudflare"` keeps state in `sst-state`.
 * Secrets are never declared: a binding with a secret's name would replace it (DEC-0087), so a
 * `SECRET_*` variable or binding name is refused, and `keepBindings` keeps the Worker's
 * secrets explicitly. All inputs are embedded as JSON, never as code.
 *
 * Step 3 (long-lived infrastructure) runs `sst deploy --target Files`; step 5 runs a full
 * `sst deploy`. Not yet run against the live API (D1 stop, DEC-0317): D-RUN's first deploy
 * verifies the generated program (DEC-PENDING-D-03-6 lists what to check).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { BINDINGS } from "../../targets/cloudflare/bindings.js";
import { cloudflareWorkerSettings } from "../../targets/cloudflare/settings.js";
import type { Stage } from "../core/operations.js";
import { LOG_BUCKET } from "./account.js";
import { sstEnvironment, type Environment } from "./environment.js";
import { filesBucketName, workerName } from "./names.js";

/** The Cloudflare provider version SST uses (PAR-108). */
export const CLOUDFLARE_PROVIDER = "6.15.0";

/** The built code of the stage's Worker and its settings (from `build --target cloudflare`; D-01, D-05). */
export interface WorkerCode {
  /** The Worker module bundle. */
  readonly bundle: string;
  /** The client's static assets, if the app has a client. */
  readonly assetsDirectory?: string;
  readonly compatibilityDate: string;
  readonly compatibilityFlags?: readonly string[];
  /** Framework variables (CFG delivery); never `SECRET_*`. The public origin is added here. */
  readonly variables?: Readonly<Record<string, string>>;
  /** The Worker binding name of the shared log bucket (D-01's log writer). */
  readonly logBucketBinding: string;
}

export interface SstInput {
  readonly stage: Stage;
  /** The stage's Worker; absent when only the long-lived bucket is declared (step 3 of a first deploy, remove). */
  readonly worker?: {
    readonly publicOrigin: string;
    /** The current database: an input, never in SST's state. */
    readonly database: { readonly id: string; readonly name: string };
    readonly code: WorkerCode;
  };
}

/** The SST component that holds the long-lived infrastructure (step 3's `--target`). */
export const INFRASTRUCTURE_COMPONENT = "Files";

function refuseSecretNames(names: readonly string[]): void {
  for (const name of names) {
    if (name.startsWith("SECRET_")) throw new Error(`the Worker binding ${name} would replace the Worker secret of that name; SECRET_* names are never declared through SST`);
  }
}

/**
 * SST's Worker `assets` argument from D-01's Worker settings (DEC-PENDING-D-06-1): the built
 * client, entry-page fallback, the Worker first for `/api` and `/api/*`. SST 4.17.2 passes
 * `notFoundHandling` and `runWorkerFirst` on as the script's `assets.config`.
 */
function workerAssets(stage: Stage, w: NonNullable<SstInput["worker"]>, directory: string) {
  const { assets } = cloudflareWorkerSettings({
    workerName: workerName(stage),
    bundle: w.code.bundle,
    assetsDirectory: directory,
    publicOrigin: w.publicOrigin,
    database: w.database,
    filesBucket: filesBucketName(stage),
  });
  return { directory: assets.directory, notFoundHandling: assets.notFoundHandling, runWorkerFirst: [...assets.runWorkerFirst] };
}

/** The generated `sst.config.ts`. */
export function sstProgram(input: SstInput): string {
  const w = input.worker;
  const worker = w
    ? {
        name: workerName(input.stage),
        handler: w.code.bundle,
        ...(w.code.assetsDirectory === undefined ? {} : { assets: workerAssets(input.stage, w, w.code.assetsDirectory) }),
        compatibilityDate: w.code.compatibilityDate,
        compatibilityFlags: [...(w.code.compatibilityFlags ?? [])],
        environment: { ...w.code.variables, [BINDINGS.publicOrigin]: w.publicOrigin },
        bindings: [
          { type: "d1", name: BINDINGS.database, id: w.database.id },
          { type: "r2_bucket", name: BINDINGS.files, bucketName: filesBucketName(input.stage) },
          { type: "r2_bucket", name: w.code.logBucketBinding, bucketName: LOG_BUCKET },
        ],
      }
    : undefined;
  if (worker) refuseSecretNames([...Object.keys(worker.environment), ...worker.bindings.map((b) => b.name)]);
  const data = { app: input.stage.app, provider: CLOUDFLARE_PROVIDER, filesBucket: filesBucketName(input.stage), worker };
  return `/// <reference path="./.sst/platform/config.d.ts" />
// Generated by @lago-morph/prototype-framework (PROV) for stage ${input.stage.stage}. Do not edit: rewritten on every deploy and remove.
const input = ${JSON.stringify(data, null, 2)} as const;

export default $config({
  app() {
    return { name: input.app, removal: "remove", home: "cloudflare", providers: { cloudflare: input.provider } };
  },
  async run() {
    new sst.cloudflare.Bucket(${JSON.stringify(INFRASTRUCTURE_COMPONENT)}, {
      transform: { bucket: (args: any) => { args.name = input.filesBucket; } },
    });
    const w: any = input.worker;
    if (w) {
      new sst.cloudflare.Worker("Worker", {
        handler: w.handler,
        url: true,
        ...(w.assets ? { assets: w.assets } : {}),
        environment: w.environment,
        transform: {
          worker: (args: any) => {
            args.scriptName = w.name;
            args.compatibilityDate = w.compatibilityDate;
            args.compatibilityFlags = w.compatibilityFlags;
            args.keepBindings = ["secret_text", "secret_key"];
            args.bindings = $util.output(args.bindings ?? []).apply((existing: any[]) => [...existing, ...w.bindings]);
          },
        },
      });
    }
    return {};
  },
});
`;
}

/** Writes the stage's SST app into `dir`. */
export function writeSstApp(dir: string, input: SstInput): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "sst.config.ts"), sstProgram(input));
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: `${input.stage.app}-sst`, private: true, type: "module" }, null, 2)}\n`);
}

/** Runs the SST CLI with `args` in `cwd`; resolves with its exit code and combined output. */
export type SstExec = (args: readonly string[], options: { readonly cwd: string; readonly env: Record<string, string> }) => Promise<{ readonly code: number; readonly output: string }>;

/** The SST binary of the pinned `sst` package (PAR-100), as `sst`'s own launcher finds it. */
export function sstBinary(): string {
  return createRequire(import.meta.url).resolve(`sst-${process.platform}-${process.arch}/bin/sst`);
}

/** The real `SstExec`: spawns `command` (default the SST binary) and collects its output. */
export function processSstExec(command: string = sstBinary()): SstExec {
  return (args, options) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, [...args], { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (d: Buffer) => (output += d.toString()));
      child.stderr.on("data", (d: Buffer) => (output += d.toString()));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? 1, output }));
    });
}

export interface SstRun {
  /** The SST app directory written by `writeSstApp`. */
  readonly dir: string;
  readonly env: Environment;
  readonly stage: Stage;
}

const TAIL_LINES = 25;

/** `sst <command> --stage <stage>` (installing SST's platform first when the directory has none). */
export async function runSst(exec: SstExec, run: SstRun, command: "deploy" | "remove", options: { readonly target?: string } = {}): Promise<void> {
  const env = sstEnvironment(run.env);
  const invoke = async (args: string[]) => {
    const r = await exec(args, { cwd: run.dir, env });
    if (r.code !== 0) {
      const tail = r.output.trimEnd().split("\n").slice(-TAIL_LINES).join("\n");
      throw new Error(`sst ${args.join(" ")} failed (exit ${r.code}):\n${tail}`);
    }
  };
  if (!existsSync(join(run.dir, ".sst", "platform"))) await invoke(["install", "--stage", run.stage.stage]);
  await invoke([command, "--stage", run.stage.stage, ...(options.target === undefined ? [] : ["--target", options.target])]);
}
