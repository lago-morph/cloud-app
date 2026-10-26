// `prepack`: copy the repository's skill/ into this package, so the published package holds the
// skill at this version. Usage: node scripts/bundle.mjs           (copy skill/ to ./skill)
//                               node scripts/bundle.mjs --clean   (`postpack`: remove ./skill)
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyTree, SKILL_SKIP } from "../../create-prototype-app/lib/create.mjs";

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
  copyTree(join(repo, "skill"), out, SKILL_SKIP);
  console.error(`bundled ${out}`);
}
