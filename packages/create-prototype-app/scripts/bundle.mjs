// `prepack`: bundle the template app and the skill into this package, so the published
// starter copies the same files the framework repository has at this version.
// Usage: node scripts/bundle.mjs [outDir]   (default: this package's folder)
//        node scripts/bundle.mjs --clean    (`postpack`: remove the bundle from this package's folder,
//                                            so the bin in a checkout reads apps/template and skill/)
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { copyTree, FRAMEWORK_PACKAGE, SKILL_SKIP, SKIP } from "../lib/create.mjs";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(pkgDir, "..", "..");

/** Copy apps/template to `<out>/template` and skill/ to `<out>/skill`; returns the two paths. */
export function bundle(out = pkgDir, { templateDir = join(repo, "apps", "template"), skillDir = join(repo, "skill") } = {}) {
  const self = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const pin = JSON.parse(readFileSync(join(templateDir, "package.json"), "utf8")).dependencies?.[FRAMEWORK_PACKAGE];
  if (pin !== self.version) {
    throw new Error(
      `the template pins ${FRAMEWORK_PACKAGE} ${pin}, but this package is ${self.version}; release them at the same version`,
    );
  }
  const template = join(out, "template");
  const skill = join(out, "skill");
  rmSync(template, { recursive: true, force: true });
  rmSync(skill, { recursive: true, force: true });
  copyTree(templateDir, template, SKIP);
  // npm never packs a file named .gitignore; create() renames it back.
  if (existsSync(join(template, ".gitignore"))) renameSync(join(template, ".gitignore"), join(template, "gitignore"));
  copyTree(skillDir, skill, SKILL_SKIP);
  return { template, skill };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--clean") {
    rmSync(join(pkgDir, "template"), { recursive: true, force: true });
    rmSync(join(pkgDir, "skill"), { recursive: true, force: true });
    process.exit(0);
  }
  const { template, skill } = bundle(process.argv[2] === undefined ? pkgDir : resolve(process.argv[2]));
  console.error(`bundled ${template} and ${skill}`);
}
