/**
 * The local secret store on disk: the app directory's git-ignored `.dev.vars` (SEC-REQ-003).
 * Node only; used by the CLI (`secrets set --target local`, `dev`), never bundled into a Worker.
 */
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { secretLocation } from "../config/secret-locations.js";
import { addMissingDevSecrets, setDevVar } from "./dev-vars.js";
import { DEV_GENERATED_SECRETS, type FrameworkSecretName } from "./names.js";

export const DEV_VARS_FILE = ".dev.vars";

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
}

/** Writes the file readable and writable by its owner only. */
async function writeText(path: string, text: string): Promise<void> {
  await writeFile(path, text, { mode: 0o600 });
  await chmod(path, 0o600);
}

/** `setSecret` for the local target: sets `SECRET_<NAME>` in `<appDir>/.dev.vars`. */
export async function setLocalSecret(appDir: string, name: string, value: string): Promise<void> {
  const path = join(appDir, DEV_VARS_FILE);
  await writeText(path, setDevVar(await readText(path), secretLocation("local", name), value));
}

/**
 * Called by `dev`: generates each missing development-only framework secret into `.dev.vars`,
 * never overwriting a value. Returns the names generated (never the values).
 */
export async function ensureDevSecrets(appDir: string): Promise<FrameworkSecretName[]> {
  const path = join(appDir, DEV_VARS_FILE);
  const { text, added } = addMissingDevSecrets(await readText(path));
  if (added.length === 0) return [];
  await writeText(path, text);
  return DEV_GENERATED_SECRETS.filter((name) => added.includes(secretLocation("local", name)));
}
