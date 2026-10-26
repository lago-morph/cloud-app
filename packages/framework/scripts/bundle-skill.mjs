// `prepack` (after the build): copy the repository's skill/ into this package as skill/, with its
// version marker, so `npm run upgrade` refreshes an app's committed copy from the installed
// framework (plan-setup-wizard §4.8a step 2, DEC-0592). Built the same way as
// packages/prototype-framework-skill.
// Usage: node scripts/bundle-skill.mjs           (copy skill/ to ./skill)
//        node scripts/bundle-skill.mjs --clean   (`postpack`: remove ./skill)
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copySkill } from "../../create-prototype-app/lib/create.mjs";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(pkgDir, "..", "..");
const out = join(pkgDir, "skill");

rmSync(out, { recursive: true, force: true });
if (process.argv[2] !== "--clean") {
  const self = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const plugin = JSON.parse(readFileSync(join(repo, "skill", ".claude-plugin", "plugin.json"), "utf8"));
  if (plugin.version !== self.version) {
    throw new Error(`skill/.claude-plugin/plugin.json is ${plugin.version}, but this package is ${self.version}; release them at the same version`);
  }
  copySkill(join(repo, "skill"), out);
  console.error(`bundled ${out}`);
}
