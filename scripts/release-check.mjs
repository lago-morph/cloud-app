#!/usr/bin/env node
// Release gate (.github/workflows/release.yml, docs/RELEASING.md).
// Usage: node scripts/release-check.mjs <tag>            check that the tag and every version agree
//        node scripts/release-check.mjs <tag> --notes    also print the CHANGELOG section (release notes)
// The framework, the create starter, the template's framework pin and the Claude Code plugin are
// released together at one version; the tag is `v<version>`.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FRAMEWORK = "@lago-morph/prototype-framework";

/** Every version that must equal the tag's, as [where, value]. */
export function versions(repo) {
  const json = (p) => JSON.parse(readFileSync(join(repo, p), "utf8"));
  return [
    ["packages/framework/package.json version", json("packages/framework/package.json").version],
    ["packages/create-prototype-app/package.json version", json("packages/create-prototype-app/package.json").version],
    [`apps/template/package.json ${FRAMEWORK} pin`, json("apps/template/package.json").dependencies?.[FRAMEWORK]],
    ["skill/.claude-plugin/plugin.json version", json("skill/.claude-plugin/plugin.json").version],
  ];
}

/** The body of the CHANGELOG section `## [version] - <date>`, or an error. */
export function changelogSection(changelog, version) {
  const lines = changelog.split("\n");
  const head = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\](.*)$`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return { error: `CHANGELOG.md has no "## [${version}]" section` };
  const rest = head.exec(lines[start])[1].trim();
  if (!/^- \d{4}-\d{2}-\d{2}$/.test(rest)) {
    return { error: `CHANGELOG.md section [${version}] must be dated "## [${version}] - YYYY-MM-DD" (found "${rest}")` };
  }
  let end = lines.findIndex((l, i) => i > start && (/^## /.test(l) || /^\[[^\]]+\]: /.test(l)));
  if (end < 0) end = lines.length;
  return { body: lines.slice(start + 1, end).join("\n").trim() };
}

/** Problems with releasing `tag` from `repo`; empty when it may be released. */
export function check(repo, tag) {
  const m = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
  if (m === null) return { problems: [`tag ${JSON.stringify(tag)} is not v<semver>`] };
  const version = m[1];
  const problems = versions(repo)
    .filter(([, v]) => v !== version)
    .map(([where, v]) => `${where} is ${JSON.stringify(v)}, the tag says ${version}`);
  const section = changelogSection(readFileSync(join(repo, "CHANGELOG.md"), "utf8"), version);
  if (section.error !== undefined) problems.push(section.error);
  return { version, problems, notes: section.body, prerelease: version.includes("-") };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tag, flag] = process.argv.slice(2);
  if (tag === undefined) {
    console.error("usage: release-check.mjs <tag> [--notes]");
    process.exit(2);
  }
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
  const r = check(repo, tag);
  if (r.problems.length > 0) {
    for (const p of r.problems) console.error(`release-check: ${p}`);
    process.exit(1);
  }
  if (flag === "--notes") process.stdout.write(`${r.notes}\n`);
  else console.error(`release-check: ${tag} ok (${r.prerelease ? "prerelease" : "release"})`);
}
