// Core of `npm create @lago-morph/prototype-app`: copy the template app into a new folder, give it
// its own name, pin the framework at the published version, and add the Claude Code skill.
// Node built-ins only: the package has no runtime dependencies.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

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
  if (skill) copyTree(skillDir, join(dir, SKILL_TARGET), SKILL_SKIP);

  return { target: dir, appName: name, packageName, skill };
}
