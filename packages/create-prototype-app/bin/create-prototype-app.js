#!/usr/bin/env node
// `npm create @lago-morph/prototype-app <dir>` runs this (npm maps @scope/name to
// @scope/create-name). See README.md for the options. Asks for no account (plan-setup-wizard §3.1).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { create, firstCommit, initRepo, localSetupLines, nextStep } from "../lib/create.mjs";

const USAGE = `usage: create-prototype-app <dir> [--name <app>] [--framework <spec>] [--no-install] [--no-skill] [--force]

  <dir>               new folder for the app (must be empty or not exist)
  --name <app>        app name: 1-20 lowercase letters and digits (default: from <dir>)
  --framework <spec>  dependency spec for @lago-morph/prototype-framework
                      (default: this package's version, the matching framework release)
  --no-install        do not run npm install (nor the local setup, which needs it)
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

// Git problems warn and never fail (owner, 2026-10-26).
const repo = initRepo(result.target);
if (repo.message !== undefined) (repo.status === "warned" ? console.error : console.log)(repo.message);

// The framework's local setup: local secrets and .env.cloudflare in .gitignore (dependencies are installed above).
// Never fails the starter: a failure is a warning, and the first commit and the next step follow (exit 0).
if (opts.install) {
  const { notes, warnings } = await localSetupLines(result.target);
  for (const n of notes) console.log(n);
  for (const w of warnings) console.error(w);
} else {
  console.log("Skipped npm install and the local setup (--no-install): no local secret values were set.");
}

if (repo.status === "initialized") {
  const commit = firstCommit(result.target, `Start ${result.appName} from @lago-morph/create-prototype-app ${self.version}`);
  if (commit.ok) console.log("Made the first git commit.");
  else console.error(commit.message);
}

if (!result.skill) {
  console.log(`Claude Code: install the skill as a plugin:
  /plugin marketplace add lago-morph/cloud-app
  /plugin install prototype-framework@lago-morph`);
}
console.log(`\n${nextStep(rel, { installed: opts.install })}`);
