/**
 * The framework and the `npm create` starter packed as `npm publish` would pack them, into a temp
 * folder, without writing into the repository (E2E-001, E2E-019; DEC-0767).
 * - The framework: `npm pack --ignore-scripts` of `packages/framework` (which needs `dist/` built:
 *   `npm run build -w packages/framework`), plus the skill its `prepack` would bundle.
 * - The starter: a copy of `packages/create-prototype-app` with its template and skill bundled by its
 *   own `scripts/bundle.mjs <outDir>` (what its `prepack` does in place), then packed and unpacked.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error the starter's library is plain JavaScript with no declarations
import { copySkill } from "../../../../packages/create-prototype-app/lib/create.mjs";
import { REPO_ROOT, run, tail } from "./process.js";

const FRAMEWORK_DIR = join(REPO_ROOT, "packages", "framework");
const STARTER_DIR = join(REPO_ROOT, "packages", "create-prototype-app");

async function npmPack(dir: string, into: string): Promise<string> {
  const r = await run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", into], { cwd: dir, timeoutMs: 300_000 });
  if (r.status !== 0) throw new Error(`npm pack in ${dir} failed:\n${tail(r.output)}`);
  const json = r.output.slice(r.output.indexOf("["));
  const [packed] = JSON.parse(json.slice(0, json.lastIndexOf("]") + 1)) as { filename: string }[];
  return join(into, packed!.filename);
}

/**
 * The framework tarball's path, as `npm publish` packs it: its files plus the skill its `prepack`
 * bundles (`scripts/bundle-skill.mjs`). The pack runs with `--ignore-scripts`, so `dist/` is not
 * rebuilt under other suites, and the skill is added here into a staging copy instead of the package
 * folder. `version` repacks it under another version (E2E-019's "0.2.0"), its skill marker included.
 */
export async function packFramework(into: string, version?: string): Promise<string> {
  if (!existsSync(join(FRAMEWORK_DIR, "dist", "index.js"))) throw new Error("build the framework first: npm run build -w packages/framework");
  const plain = await npmPack(FRAMEWORK_DIR, mkdtempSync(join(into, "pack-")));
  const copy = mkdtempSync(join(into, "framework-"));
  // Synchronous: tar reads no standard input, which `run` would write to (EPIPE).
  execFileSync("tar", ["xzf", plain, "-C", copy, "--strip-components=1"]);
  copySkill(join(REPO_ROOT, "skill"), join(copy, "skill"));
  if (version !== undefined) {
    const pkg = JSON.parse(readFileSync(join(copy, "package.json"), "utf8")) as Record<string, unknown>;
    writeFileSync(join(copy, "package.json"), `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
    writeFileSync(join(copy, "skill", "VERSION"), `${version}\n`);
  }
  return npmPack(copy, into);
}

/** The unpacked starter package's folder (holding `bin/create-prototype-app.js`). */
export async function packStarter(into: string): Promise<string> {
  const copy = join(into, "starter-src");
  cpSync(STARTER_DIR, copy, { recursive: true, filter: (src) => !src.includes("node_modules") });
  // The repository's bundle script, so it reads apps/template and skill/ here, writing into the copy.
  const bundled = await run(process.execPath, [join(STARTER_DIR, "scripts", "bundle.mjs"), copy], { cwd: copy, timeoutMs: 300_000 });
  if (bundled.status !== 0) throw new Error(`bundling the starter failed:\n${tail(bundled.output)}`);
  const tarball = await npmPack(copy, into);
  const out = join(into, "starter");
  mkdirSync(out, { recursive: true });
  execFileSync("tar", ["xzf", tarball, "-C", out, "--strip-components=1"]);
  return out;
}
