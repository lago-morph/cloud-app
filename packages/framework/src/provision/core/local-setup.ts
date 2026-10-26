/**
 * The project's local setup (plan-setup-wizard §3.1, §4.3 step 0; DEC-0591): dependencies
 * installed, a random local value for each secret, and `.env.cloudflare` listed in `.gitignore`.
 * `npm create @lago-morph/prototype-app` runs it after `npm install`, and `cloudflare-setup` runs
 * it first. Idempotent: each step does only what is missing, and never changes a value that is
 * set. Git problems warn and never fail (owner, 2026-10-26). No output names a secret's value.
 * Node only.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { secretLocation } from "../../config/secret-locations.js";
import { ensureEnvCloudflareIgnored, KEEP_TRACKED_MARKER } from "../cloudflare/git-safety.js";
import { ENV_CLOUDFLARE_FILE } from "../cloudflare/token-sources.js";
import { DEV_SECRET_BYTES, readDevVars, setDevVar } from "../../secrets/dev-vars.js";
import { DEV_GENERATED_SECRETS } from "../../secrets/local-names.js";

export type LocalSetupStep = "dependencies" | "local-secrets" | "gitignore";

export interface LocalSetupOutcome {
  readonly step: LocalSetupStep;
  readonly result: "already" | "applied" | "warned";
  readonly message?: string;
}

export type EnsureIgnoredResult = "added" | "already" | "kept-tracked-marker" | "not-a-repo";

export interface LocalSetupDeps {
  /** Installs the project's dependencies (default: `npm install` in `dir`, output shown). */
  npmInstall(dir: string): Promise<void>;
  /** Lists `.env.cloudflare` in `.gitignore` unless the marker line says not to (default: git-safety's `ensureEnvCloudflareIgnored`, DEC-0572). */
  ensureIgnored(dir: string): Promise<EnsureIgnoredResult> | EnsureIgnoredResult;
  /** Secure random bytes (default: `crypto.getRandomValues`). */
  random(size: number): Uint8Array;
  /** The secret names the app in `dir` declares (default: loaded from `src/app.ts`). */
  declaredSecrets(dir: string): Promise<readonly string[]>;
}

export { ENV_CLOUDFLARE_FILE, KEEP_TRACKED_MARKER };
/** The local secret store (SEC-REQ-003). */
const DEV_VARS_FILE = ".dev.vars";

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** True when every dependency in `<dir>/package.json` resolves the way Node finds it: `node_modules/<name>` here or in a parent. */
export function dependenciesInstalled(dir: string, pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): boolean {
  const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  return names.every((name) => {
    for (let at = resolve(dir); ; at = dirname(at)) {
      if (existsSync(join(at, "node_modules", name, "package.json"))) return true;
      if (dirname(at) === at) return false;
    }
  });
}

async function npmInstall(dir: string): Promise<void> {
  await new Promise<void>((done, fail) => {
    const child = spawn("npm", ["install", "--no-audit", "--no-fund"], { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", fail);
    child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`npm install exited with status ${code ?? "unknown"}`))));
  });
}

async function declaredSecrets(dir: string): Promise<readonly string[]> {
  const { loadApp } = await import("../../build/load.js");
  return (await loadApp(dir)).definition.secrets;
}

function encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function dependencies(dir: string, deps: LocalSetupDeps): Promise<LocalSetupOutcome> {
  const file = join(dir, "package.json");
  if (!existsSync(file)) return { step: "dependencies", result: "warned", message: `no package.json in ${dir}; dependencies not installed` };
  const pkg = JSON.parse(await readFile(file, "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  if (dependenciesInstalled(dir, pkg)) return { step: "dependencies", result: "already" };
  try {
    await deps.npmInstall(dir);
  } catch (error) {
    return { step: "dependencies", result: "warned", message: `npm install failed (${message(error)}); run it again in ${dir}` };
  }
  return { step: "dependencies", result: "applied", message: "installed the dependencies (npm install)" };
}

async function localSecrets(dir: string, deps: LocalSetupDeps): Promise<LocalSetupOutcome> {
  let names: readonly string[];
  try {
    names = [...DEV_GENERATED_SECRETS, ...(await deps.declaredSecrets(dir))];
  } catch (error) {
    return { step: "local-secrets", result: "warned", message: `could not read the app's secret names, so no local secret was set: ${message(error)}` };
  }
  const path = join(dir, DEV_VARS_FILE);
  const before = existsSync(path) ? await readFile(path, "utf8") : "";
  const present = readDevVars(before);
  let text = before;
  const added: string[] = [];
  for (const name of names) {
    const location = secretLocation("local", name);
    if ((present[location] ?? "") !== "" || added.includes(name)) continue;
    text = setDevVar(text, location, encode(deps.random(DEV_SECRET_BYTES)));
    added.push(name);
  }
  if (added.length === 0) return { step: "local-secrets", result: "already" };
  await writeFile(path, text, { mode: 0o600 });
  await chmod(path, 0o600);
  return { step: "local-secrets", result: "applied", message: `set a random local value for ${added.join(", ")} in ${DEV_VARS_FILE}` };
}

async function gitignore(dir: string, deps: LocalSetupDeps): Promise<LocalSetupOutcome> {
  let r: EnsureIgnoredResult;
  try {
    r = await deps.ensureIgnored(dir);
  } catch (error) {
    return { step: "gitignore", result: "warned", message: `WARNING: could not check that git ignores ${ENV_CLOUDFLARE_FILE}: ${message(error)}` };
  }
  switch (r) {
    case "already":
      return { step: "gitignore", result: "already" };
    case "added":
      return { step: "gitignore", result: "applied", message: `added ${ENV_CLOUDFLARE_FILE} to .gitignore` };
    case "kept-tracked-marker":
      return {
        step: "gitignore",
        result: "warned",
        message: `WARNING: ${ENV_CLOUDFLARE_FILE} is not git-ignored, because .gitignore has the line "${KEEP_TRACKED_MARKER}". Tokens in that file would be committed.`,
      };
    case "not-a-repo":
      return {
        step: "gitignore",
        result: "warned",
        message: `WARNING: this folder is not a git repository, or git is not installed, so ${ENV_CLOUDFLARE_FILE} is not git-ignored. Run \`git init\`, then run this again.`,
      };
  }
}

/**
 * Runs the three local setup steps in order and returns one outcome per step. Never throws for a
 * step's failure: a step that cannot complete is "warned" with a message saying what to do.
 */
export async function runLocalSetup(projectDir: string, deps: Partial<LocalSetupDeps> = {}): Promise<LocalSetupOutcome[]> {
  const all: LocalSetupDeps = {
    npmInstall,
    ensureIgnored: ensureEnvCloudflareIgnored,
    random: (size) => crypto.getRandomValues(new Uint8Array(size)),
    declaredSecrets,
    ...deps,
  };
  const dir = resolve(projectDir);
  return [await dependencies(dir, all), await localSecrets(dir, all), await gitignore(dir, all)];
}

/** One line per outcome that has something to say (applied or warned). */
export function describeLocalSetup(outcomes: readonly LocalSetupOutcome[]): string[] {
  return outcomes.filter((o) => o.message !== undefined).map((o) => `local setup (${o.step}): ${o.message ?? ""}`);
}
