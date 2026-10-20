/**
 * Copies of the reference app, stage deploys and secrets for the E2E scenarios.
 *
 * A copy lives under the repository's git-ignored `.framework/e2e/`, so the copy resolves the
 * workspace's `node_modules` like `apps/reference` does and the working tree stays clean (the
 * driver refuses to record evidence from a dirty tree).
 */
import { randomBytes } from "node:crypto";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { deployOrigin } from "../../harness/node-deps.js";
import { REPO_ROOT, frameworkCli, tail } from "./process.js";

/** Local state, build output and dev-only secrets are never copied (root .gitignore). */
const SKIP = new Set(["node_modules", "dist", ".framework", ".wrangler", ".logs", ".dev.vars", "test-results", "playwright-report", "blob-report"]);

export function randomSuffix(bytes = 6): string {
  return randomBytes(bytes).toString("hex");
}

/** Copies `appDir` to `.framework/e2e/<label>-<random>/` and returns the copy's directory. */
export function copyApp(appDir: string, label: string): string {
  const dir = join(REPO_ROOT, ".framework", "e2e", `${label}-${randomSuffix()}`);
  mkdirSync(dir, { recursive: true });
  cpSync(appDir, dir, { recursive: true, filter: (src) => !relative(appDir, src).split(sep).some((part) => SKIP.has(part)) });
  return dir;
}

/**
 * Applies a migration overlay (`apps/reference/versions/<name>/`) to a copy, as ROUTES.md
 * "Migration overlays" says: remove the copy's `migrations/`, then copy the overlay's files over.
 */
export function applyOverlay(copyDir: string, overlayDir: string): void {
  rmSync(join(copyDir, "migrations"), { recursive: true, force: true });
  cpSync(overlayDir, copyDir, { recursive: true, force: true });
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

const CLI_MS = 300_000;
const DEPLOY_MS = 900_000;

/** `secrets set <name> --target <t> --stage <s>` with the value on standard input only. */
export async function setSecret(appDir: string, targetName: string, stage: string, name: string, value: string): Promise<void> {
  const result = await frameworkCli(appDir, ["secrets", "set", name, "--target", targetName, "--stage", stage], { input: value, timeoutMs: CLI_MS });
  if (result.status !== 0) throw new Error(`secrets set ${name} --target ${targetName} --stage ${stage} exited ${String(result.status)}:\n${tail(result.output)}`);
}

export interface Deployed {
  readonly origin: string;
  readonly output: string;
}

/**
 * `deploy --target <t> --stage <s>`. On a stage's first Cloudflare deploy the CLI stops after
 * creating the Worker when a declared secret is unset, names it, and asks for `secrets set` and
 * another deploy (provisioning.md "First Cloudflare deploy"); `secrets` gives the values to set
 * then. Returns the printed public origin.
 */
export async function deployStage(appDir: string, targetName: string, stage: string, secrets: Readonly<Record<string, string>> = {}): Promise<Deployed> {
  if (!stage.startsWith("test-")) throw new Error(`E2E scenarios deploy test stages only, not ${stage}`);
  let result = await frameworkCli(appDir, ["deploy", "--target", targetName, "--stage", stage], { timeoutMs: DEPLOY_MS });
  let output = result.output;
  const missing = Object.keys(secrets).filter((name) => result.status !== 0 && result.output.includes(name));
  if (missing.length > 0) {
    for (const name of missing) await setSecret(appDir, targetName, stage, name, secrets[name] ?? "");
    result = await frameworkCli(appDir, ["deploy", "--target", targetName, "--stage", stage], { timeoutMs: DEPLOY_MS });
    output += `\n--- deploy again after secrets set ${missing.join(", ")} ---\n${result.output}`;
  }
  if (result.status !== 0) throw new Error(`deploy --target ${targetName} --stage ${stage} exited ${String(result.status)}:\n${tail(output)}`);
  const origin = deployOrigin(result.output);
  if (origin === undefined) throw new Error(`deploy --target ${targetName} --stage ${stage} printed no public origin:\n${tail(output)}`);
  return { origin, output };
}

/** `remove --target <t> --stage <s>` (test stages only); returns the result, never throws on a failed removal. */
export async function removeStage(appDir: string, targetName: string, stage: string): Promise<{ readonly status: number; readonly output: string }> {
  if (!stage.startsWith("test-")) throw new Error(`E2E scenarios remove test stages only, not ${stage}`);
  return frameworkCli(appDir, ["remove", "--target", targetName, "--stage", stage], { timeoutMs: DEPLOY_MS });
}
