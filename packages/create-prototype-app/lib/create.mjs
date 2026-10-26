// Core of `npm create @lago-morph/prototype-app`: copy the template app into a new folder, give it
// its own name, pin the framework at the published version, and add the Claude Code skill; then
// the git repository and its first commit, around the framework's local setup (plan-setup-wizard §3.1).
// Node built-ins only: the package has no runtime dependencies.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const FRAMEWORK_PACKAGE = "@lago-morph/prototype-framework";

/** Where the skill goes in a new app: a project skill Claude Code loads from the app's folder. */
export const SKILL_TARGET = join(".claude", "skills", "prototype-framework");

/** App names: lowercase letters and digits, at most 20 characters (PAR-290). */
export const APP_NAME = /^[a-z0-9]{1,20}$/;

/**
 * Never copied: dependencies, build output, local state, dev-only secrets and test output
 * (the template's own .gitignore), and the skill's repository-only scripts.
 */
export const SKIP = new Set([
  "node_modules",
  "dist",
  ".framework",
  ".wrangler",
  ".logs",
  ".dev.vars",
  "test-results",
  "playwright-report",
  "blob-report",
]);

/** The skill's parts a new app gets: everything but the repository's scaffolder and its tests. */
export const SKILL_SKIP = new Set([...SKIP, "scripts", ".keep", ".claude-plugin"]);

/** Copy `from` into `to`, leaving out any path with a part in `skip`. */
export function copyTree(from, to, skip) {
  cpSync(from, to, {
    recursive: true,
    force: true,
    filter: (src) => !relative(from, src).split(sep).some((part) => skip.has(part)),
  });
}

/** The skill's version marker: one line, the version the skill was released at (DEC-0592). */
export const SKILL_VERSION_FILE = "VERSION";

/**
 * Copy the skill in `from` to `to` (SKILL_SKIP left out) and give the copy its version marker:
 * from the plugin manifest of the repository's skill/, or the marker an earlier copy carries.
 * Returns the version, or undefined when `from` has neither.
 */
export function copySkill(from, to) {
  copyTree(from, to, SKILL_SKIP);
  const manifest = join(from, ".claude-plugin", "plugin.json");
  if (existsSync(manifest)) {
    const { version } = JSON.parse(readFileSync(manifest, "utf8"));
    writeFileSync(join(to, SKILL_VERSION_FILE), `${version}\n`);
    return version;
  }
  const marker = join(to, SKILL_VERSION_FILE);
  return existsSync(marker) ? readFileSync(marker, "utf8").trim() : undefined;
}

/** The app name derived from a folder name: lowercase letters and digits only, cut to 20. */
export function appNameFrom(dir) {
  return basename(resolve(dir)).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
}

/** An npm package name derived from a folder name (lowercase, URL-safe characters). */
export function packageNameFrom(dir) {
  const name = basename(resolve(dir))
    .toLowerCase()
    .replace(/[^a-z0-9._~-]+/g, "-")
    .replace(/^[._-]+/, "");
  return name === "" ? "app" : name.slice(0, 214);
}

/** Replace exactly one occurrence of `from` in `file`, or throw naming the file. */
function replaceOnce(file, from, to) {
  const text = readFileSync(file, "utf8");
  const at = text.indexOf(from);
  if (at < 0 || text.indexOf(from, at + 1) >= 0) {
    throw new Error(`expected exactly one ${JSON.stringify(from)} in ${file}; the template has changed`);
  }
  writeFileSync(file, text.slice(0, at) + to + text.slice(at + from.length));
}

/**
 * Create a new app in `target`.
 * Refuses, before writing anything, when `target` exists and is not empty (unless `force`), or
 * when the app name is not valid.
 *
 * @param {{ target: string, templateDir: string, skillDir?: string | null, frameworkSpec: string,
 *           appName?: string, force?: boolean }} options
 * @returns {{ target: string, appName: string, packageName: string, skill: boolean }}
 */
export function create({ target, templateDir, skillDir = null, frameworkSpec, appName, force = false }) {
  const dir = resolve(target);
  const name = appName ?? appNameFrom(dir);
  if (!APP_NAME.test(name)) {
    throw new Error(
      `app name ${JSON.stringify(name)} is not valid: use 1 to 20 lowercase letters and digits (pass --name <name>)`,
    );
  }
  if (typeof frameworkSpec !== "string" || frameworkSpec === "") {
    throw new Error("no framework version given");
  }
  if (!force && existsSync(dir) && readdirSync(dir).length > 0) {
    throw new Error(
      `target directory ${dir} is not empty; nothing was changed. Choose an empty directory, or pass --force to overwrite existing files.`,
    );
  }

  mkdirSync(dir, { recursive: true });
  copyTree(templateDir, dir, SKIP);

  // npm never packs a file named .gitignore, so the published template carries it as `gitignore`.
  if (existsSync(join(dir, "gitignore"))) renameSync(join(dir, "gitignore"), join(dir, ".gitignore"));

  const pkgFile = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
  if (pkg.dependencies?.[FRAMEWORK_PACKAGE] === undefined) {
    throw new Error(`the template's package.json does not depend on ${FRAMEWORK_PACKAGE}`);
  }
  const packageName = packageNameFrom(dir);
  pkg.name = packageName;
  pkg.dependencies[FRAMEWORK_PACKAGE] = frameworkSpec;
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");

  replaceOnce(join(dir, "src", "app.ts"), 'name: "template",', `name: "${name}",`);
  replaceOnce(join(dir, "index.html"), "<title>template</title>", `<title>${name}</title>`);

  const skill = skillDir !== null && existsSync(join(skillDir, "SKILL.md"));
  if (skill) copySkill(skillDir, join(dir, SKILL_TARGET));

  return { target: dir, appName: name, packageName, skill };
}

/** Runs git in `dir`; `{ error }` when git is missing or cannot start. */
function runGit(git, dir, args) {
  const r = spawnSync(git, args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.error !== undefined) return { error: r.error };
  return { status: r.status, stderr: (r.stderr ?? "").trim().split("\n")[0] ?? "" };
}

/**
 * `git init` in `dir` (DEC-0596). Never throws: git missing or failing is a warning. A folder that
 * is already inside a git work tree (a repository checkout) is left to that repository.
 *
 * @returns {{ status: "initialized" | "inside-repo" | "warned", message?: string }}
 */
export function initRepo(dir, { git = "git" } = {}) {
  const inside = runGit(git, dir, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.error !== undefined) {
    return { status: "warned", message: "WARNING: git was not found, so this folder is not a git repository. Install git, then run `git init` here." };
  }
  if (inside.status === 0) return { status: "inside-repo", message: "This folder is inside an existing git repository: no new repository, and nothing committed." };
  const r = runGit(git, dir, ["init", "-q"]);
  if (r.error !== undefined || r.status !== 0) {
    return { status: "warned", message: `WARNING: git init failed${r.stderr ? ` (${r.stderr})` : ""}, so this folder is not a git repository. Run \`git init\` here.` };
  }
  return { status: "initialized" };
}

/**
 * The first commit of everything not ignored (DEC-0596). Never throws: a failure (for example
 * no `user.name` / `user.email`) is a warning naming the commands to run.
 *
 * @returns {{ ok: boolean, message?: string }}
 */
export function firstCommit(dir, message, { git = "git" } = {}) {
  const add = runGit(git, dir, ["add", "-A"]);
  const commit = add.error === undefined && add.status === 0 ? runGit(git, dir, ["commit", "-q", "-m", message]) : add;
  if (commit.error !== undefined || commit.status !== 0) {
    const why = commit.error === undefined && commit.stderr ? ` (${commit.stderr})` : "";
    return { ok: false, message: `WARNING: the first commit failed${why}. Commit yourself: git add -A && git commit -m "First commit"` };
  }
  return { ok: true };
}

/**
 * The framework's local setup (`runLocalSetup`, DEC-0591), loaded from the app's installed
 * framework, so the starter and `cloudflare-setup` run the same steps. Undefined when the
 * installed framework does not have it.
 */
export async function loadLocalSetup(appDir) {
  try {
    const entry = createRequire(join(appDir, "package.json")).resolve(`${FRAMEWORK_PACKAGE}/provision`);
    const mod = await import(pathToFileURL(entry).href);
    return typeof mod.runLocalSetup === "function" ? { runLocalSetup: mod.runLocalSetup, describeLocalSetup: mod.describeLocalSetup } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Runs the local setup in `appDir` and returns what to print. Never throws: a framework without
 * it, or a run that throws, is a warning naming how to set the secrets by hand. The app stays
 * usable either way (`dev` generates the framework's own keys), so the starter carries on to the
 * first commit and exits 0 (DEC-0596).
 *
 * @returns {Promise<{ notes: string[], warnings: string[] }>}
 */
export async function localSetupLines(appDir, { load = loadLocalSetup } = {}) {
  const byHand = "set the app's secrets with `npm run secrets -- set <name> --target local --stage local`.";
  let setup;
  try {
    setup = await load(appDir);
  } catch {
    setup = undefined;
  }
  if (setup === undefined) return { notes: [], warnings: [`WARNING: the installed framework has no local setup; ${byHand}`] };
  try {
    const outcomes = await setup.runLocalSetup(appDir);
    const said = outcomes.filter((o) => o.message !== undefined);
    return { notes: said.filter((o) => o.result !== "warned").map((o) => o.message), warnings: said.filter((o) => o.result === "warned").map((o) => o.message) };
  } catch (error) {
    return { notes: [], warnings: [`WARNING: the local setup failed (${error instanceof Error ? error.message : String(error)}). Run \`npm run dev\` once, then ${byHand}`] };
  }
}

/** The closing line (plan §3.1): what to do next, with the folder as the owner would type it. */
export function nextStep(rel, { installed = true } = {}) {
  const run = installed ? "`npm run dev`" : "`npm install` and `npm run dev`";
  return rel === "." ? `Run ${run}, or open this folder in Claude Code and say what to build.` : `cd ${rel}, then ${run}, or open this folder in Claude Code and say what to build.`;
}
