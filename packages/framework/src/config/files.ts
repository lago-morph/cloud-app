/**
 * Which committed values file a build reads (CFG-REQ-002, DEC-0081, config.md §2 "Files").
 * Paths are relative to the app's root, with `/` separators. The reader is passed in so the
 * selection has no file-system dependency; `nodeFileReader` is the build's reader.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FrameworkError } from "../core/errors.js";
import type { Deployment } from "../core/identity.js";
import type { ConfigDeclaration } from "./public.js";
import { resolveConfig, type ResolvedConfig } from "./resolve.js";
import { parseStageConfig, type StageConfigFile } from "./schema.js";

/** Returns a file's text, or `undefined` when the file does not exist. */
export type FileReader = (path: string) => string | undefined;

/**
 * The local target uses `config/local.json` for every stage. On a cloud target a test stage
 * (`test-*`) uses `config/<target>/test.json`; every other stage uses its own
 * `config/<target>/<stage>.json`, with no fallback.
 */
export function stageConfigPath(deployment: Deployment): string {
  if (deployment.target === "local") return "config/local.json";
  const file = deployment.isTestStage ? "test" : deployment.stage;
  return `config/${deployment.target}/${file}.json`;
}

/** Reads and validates the deployment's values file. Throws CORE.MISCONFIGURED naming a missing file. */
export function readStageConfig(deployment: Deployment, read: FileReader): { readonly file: string; readonly config: StageConfigFile } {
  const file = stageConfigPath(deployment);
  const text = read(file);
  if (text === undefined) {
    const kind = deployment.isTestStage || deployment.target === "local" ? "" : `; stage "${deployment.stage}" is a production stage and needs its own committed values file`;
    throw new FrameworkError("CORE.MISCONFIGURED", `committed values file ${file} is missing${kind}`);
  }
  return { file, config: parseStageConfig(text, file) };
}

/**
 * What the build calls: selects, validates and resolves the deployment's values file against
 * the app's declared keys and secrets. Throws CORE.MISCONFIGURED naming the file and each problem.
 */
export function resolveStageConfig(
  deployment: Deployment,
  app: { readonly config: ConfigDeclaration; readonly secrets: readonly string[] },
  read: FileReader,
): ResolvedConfig {
  const { file, config } = readStageConfig(deployment, read);
  return resolveConfig({ deployment, declaration: app.config, secrets: app.secrets, file, config });
}

/** A reader over the app directory on disk. */
export function nodeFileReader(appDir: string): FileReader {
  return (path) => {
    try {
      return readFileSync(join(appDir, path), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  };
}
