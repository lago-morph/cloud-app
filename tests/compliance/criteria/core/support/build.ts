/**
 * The resolved configuration of a deployment (CFG §2 "Resolution", "Delivery"): `build` writes
 * the target entry points under `.framework/` (cli.md §2), and the resolved configuration is
 * embedded as a generated module with no imports whose default export is it, as JSON data. The
 * module's file name is not contracted, so it is found by those properties.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cli, scratchCopy } from "./processes.js";

export interface ResolvedConfigView {
  readonly deployment: { readonly app: string; readonly stage: string } & Record<string, unknown>;
  readonly values?: Record<string, unknown>;
  readonly admins?: readonly string[];
  readonly users?: readonly string[];
  readonly secrets: readonly { readonly name: string; readonly location: string }[];
}

function looksResolved(value: unknown): value is ResolvedConfigView {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const d = v.deployment as Record<string, unknown> | undefined;
  return typeof d === "object" && d !== null && typeof d.app === "string" && typeof d.stage === "string" && Array.isArray(v.secrets);
}

/** The resolved configuration in `<appDir>/.framework/<target>/`, or undefined when no build output holds one. */
export async function readResolvedConfig(appDir: string, targetName: string): Promise<ResolvedConfigView | undefined> {
  const dir = join(appDir, ".framework", targetName);
  if (!existsSync(dir)) return undefined;
  for (const name of (await readdir(dir)).filter((n) => /\.(mjs|js)$/.test(n)).sort()) {
    const path = join(dir, name);
    const text = await readFile(path, "utf8");
    if (/^\s*import\s/m.test(text)) continue;
    try {
      const mod = (await import(`${pathToFileURL(path).href}?t=${String(Date.now())}`)) as { default?: unknown };
      if (looksResolved(mod.default)) return mod.default;
    } catch {
      // not a plain data module
    }
  }
  return undefined;
}

/**
 * The resolved configuration of `appDir` built for `targetName`/`stage`: the existing build output
 * when it is for that stage (the run's own deployment), else a fresh `build` of a scratch copy.
 */
export async function resolvedConfigFor(appDir: string, targetName: string, stage: string): Promise<{ config: ResolvedConfigView; source: string }> {
  const existing = await readResolvedConfig(appDir, targetName);
  if (existing?.deployment.stage === stage) return { config: existing, source: `${appDir}/.framework/${targetName}` };
  const copy = await scratchCopy(appDir, "resolved-config");
  try {
    const built = await cli(["build", "--target", targetName, "--stage", stage], { cwd: copy.dir, timeoutMs: 300_000 });
    if (built.status !== 0) throw new Error(`build --target ${targetName} --stage ${stage} failed with status ${String(built.status)}:\n${built.output.slice(-2000)}`);
    const config = await readResolvedConfig(copy.dir, targetName);
    if (config === undefined) throw new Error(`build --target ${targetName} --stage ${stage} wrote no resolved configuration module under .framework/${targetName}/`);
    return { config, source: "a fresh build of a scratch copy" };
  } finally {
    await copy.remove();
  }
}
