#!/usr/bin/env node
// `npm create @lago-morph/prototype-app <dir>` runs this (npm maps @scope/name to
// @scope/create-name). See README.md for the options.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { create } from "../lib/create.mjs";

const USAGE = `usage: create-prototype-app <dir> [--name <app>] [--framework <spec>] [--no-install] [--no-skill] [--force]

  <dir>               new folder for the app (must be empty or not exist)
  --name <app>        app name: 1-20 lowercase letters and digits (default: from <dir>)
  --framework <spec>  dependency spec for @lago-morph/prototype-framework
                      (default: this package's version, the matching framework release)
  --no-install        do not run npm install
  --no-skill          do not copy the Claude Code skill into .claude/skills/
  --force             overwrite files in a non-empty <dir>`;

function parse(argv) {
  const opts = { install: true, skill: true, force: false, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--no-install") opts.install = false;
    else if (a === "--no-skill") opts.skill = false;
    else if (a === "--force") opts.force = true;
    else if (a === "--name" || a === "--framework") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      opts[a.slice(2)] = v;
    } else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else opts.positional.push(a);
  }
  if (!opts.help && opts.positional.length !== 1) throw new Error("give exactly one <dir>");
  return opts;
}

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const self = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
// Published package: template/ and skill/ are bundled at pack time (scripts/bundle.mjs).
// In the framework repository they are read from apps/template and skill/.
const bundled = existsSync(join(here, "template", "package.json"));
const templateDir = bundled ? join(here, "template") : join(here, "..", "..", "apps", "template");
const skillDir = bundled ? join(here, "skill") : join(here, "..", "..", "skill");

let opts;
try {
  opts = parse(process.argv.slice(2));
} catch (err) {
  console.error(`create-prototype-app: ${err.message}\n\n${USAGE}`);
  process.exit(2);
}
if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}

let result;
try {
  result = create({
    target: opts.positional[0],
    templateDir,
    skillDir: opts.skill ? skillDir : null,
    frameworkSpec: opts.framework ?? self.version,
    ...(opts.name === undefined ? {} : { appName: opts.name }),
    force: opts.force,
  });
} catch (err) {
  console.error(`create-prototype-app: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const relPath = relative(process.cwd(), result.target) || ".";
const rel = /[^\w./-]/.test(relPath) ? JSON.stringify(relPath) : relPath;
console.log(`Created ${result.appName} in ${result.target}.`);
if (result.skill) console.log("Added the Claude Code skill in .claude/skills/prototype-framework/.");

if (opts.install) {
  console.log("Running npm install ...");
  const r = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: result.target,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    console.error(`create-prototype-app: npm install failed; run it again in ${result.target}`);
    process.exit(1);
  }
}

console.log(`
Next steps:
  cd ${rel}${opts.install ? "" : "\n  npm install"}
  npm run dev        # serve the app locally
  npm run verify     # check everything before calling a change done

The owner's guide (local and Cloudflare) is README.md in the new folder.
Claude Code: ${result.skill ? "the skill is in .claude/skills/prototype-framework/. Or i" : "i"}nstall it as a plugin:
  /plugin marketplace add lago-morph/cloud-app
  /plugin install prototype-framework@lago-morph`);
