/**
 * `build --target <t> --stage <s>` (CLI-REQ-001): build a deployment without deploying it,
 * through the build pipeline (`src/build/`), into `<app>/.framework/<target>/`.
 */
import { relative } from "node:path";
import type { BuildOptions } from "../../build/build.js";
import { parseTargetStage } from "../args.js";
import { EXIT, type Command } from "../io.js";

export interface BuildDeps {
  buildApp(options: BuildOptions): Promise<{ readonly outDir: string; readonly deployment: { readonly app: string; readonly stage: string } }>;
}

export function buildCommand(deps: BuildDeps): Command {
  return async (args, io) => {
    const { target, stage } = parseTargetStage(args);
    const result = await deps.buildApp({ appDir: io.cwd, target, stage });
    const where = relative(io.cwd, result.outDir).split("\\").join("/") || ".";
    io.stdout(`built ${result.deployment.app} for target ${target}, stage ${stage}: ${where}/\n`);
    return EXIT.ok;
  };
}
