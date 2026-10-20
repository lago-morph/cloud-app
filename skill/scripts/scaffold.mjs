// Scaffolder core (SKILL-REQ-005, E2E-001). `scaffold` (the CLI next to this file) packs the
// framework and calls this; tests call it with a fixture template and a fake install step.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

export const FRAMEWORK_PACKAGE = "@lago-morph/prototype-framework";

// Build output, dependencies, local state and dev-only secrets are never copied (root .gitignore).
const SKIP = new Set([
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

/**
 * Copy the template into `target`, point the framework dependency at the `npm pack` tarball
 * (copied into `<target>/vendor/`), then run `install(target)`.
 * Refuses, before writing anything, when `target` exists and is not empty, unless `force`.
 *
 * @param {{ target: string, templateDir: string, tarball: string, version: string,
 *           install: (dir: string) => void | Promise<void>, force?: boolean }} options
 */
export async function scaffold({ target, templateDir, tarball, version, install, force = false }) {
  const pkg = JSON.parse(readFileSync(join(templateDir, "package.json"), "utf8"));
  const pinned = pkg.dependencies?.[FRAMEWORK_PACKAGE];
  if (pinned !== version) {
    throw new Error(
      `framework tarball version ${version} does not match the template's exact pin ${pinned} of ${FRAMEWORK_PACKAGE}`,
    );
  }
  if (!force && existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(
      `target directory ${target} is not empty; nothing was changed. Choose an empty directory, or pass --force to overwrite existing files.`,
    );
  }

  mkdirSync(target, { recursive: true });
  cpSync(templateDir, target, {
    recursive: true,
    force: true,
    filter: (src) => !relative(templateDir, src).split(sep).some((part) => SKIP.has(part)),
  });

  const tgz = basename(tarball);
  mkdirSync(join(target, "vendor"), { recursive: true });
  cpSync(tarball, join(target, "vendor", tgz));
  pkg.dependencies[FRAMEWORK_PACKAGE] = `file:vendor/${tgz}`;
  writeFileSync(join(target, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

  await install(target);
}
