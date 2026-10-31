#!/usr/bin/env node
// CI change classification (plan-v0.2.0 §7a.2.4): which linters and test layers a PR's changed
// files select, from the committed path map scripts/ci/path-map.json.
// Usage: node scripts/ci/classify.mjs --base <rev> [--head <rev>]   classify `git diff --name-only base head`
//        node scripts/ci/classify.mjs --files <path>…                classify the given paths
//        node scripts/ci/classify.mjs --all                           everything (the release run)
//        node scripts/ci/classify.mjs --check-duplicates              exit 1 if a test file is in two layers
//        add --json to print the result as JSON instead of the readable report, and
//        --github-output <file> to append the CI plan's outputs (githubOutput) to <file>.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A repository-root-anchored glob: `**` any depth, `*` and `?` within one segment, `{a,b}` alternatives. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      re += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      re += `(?:${glob.slice(i + 1, end).split(",").map((alt) => globToRegExp(alt).source.slice(1, -1)).join("|")})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Whether `path` matches `globs`; a later `!glob` excludes what earlier globs matched. */
export function matches(path, globs) {
  let hit = false;
  for (const g of globs) {
    if (g.startsWith("!")) hit &&= !globToRegExp(g.slice(1)).test(path);
    else hit ||= globToRegExp(g).test(path);
  }
  return hit;
}

export function loadMap(root = ROOT) {
  return JSON.parse(readFileSync(join(root, "scripts", "ci", "path-map.json"), "utf8"));
}

const componentGlobs = (c) => [...c.integration.map((d) => `${d}/**`), ...c.paths];

/** The layers `files` select. `integration` maps each selected component to why it was selected. */
export function classify(files, map, options = {}) {
  const r = { docs: [], testInputs: [], code: [], unit: { all: false, files: [] }, linters: [], build: false, integration: {}, e2e: { all: false, specs: [] }, chromium: false };
  const linters = new Set();
  const unitFiles = new Set();
  const specs = new Set();
  const why = new Map();
  const select = (code, reason) => why.set(code, new Set([...(why.get(code) ?? []), reason]));
  const changedSource = new Set();
  let everything = options.everything === true;
  for (const f of files) {
    for (const [name, globs] of Object.entries(map.linters)) if (matches(f, globs)) linters.add(name);
    if (matches(f, map.docs)) {
      const inputs = map.testInputs.filter((t) => matches(f, t.paths));
      if (inputs.length === 0) {
        r.docs.push(f);
        continue;
      }
      r.testInputs.push(f);
      for (const t of inputs) {
        for (const u of t.unit ?? []) unitFiles.add(u);
        if (t.typecheck === true) linters.add("typecheck");
        for (const code of t.integration ?? []) select(code, `test input ${f}`);
      }
      continue;
    }
    r.code.push(f);
    if (matches(f, map.everything)) {
      everything = true;
      continue;
    }
    if (matches(f, map.e2e.specs)) {
      specs.add(f);
      continue;
    }
    r.unit.all = true;
    if (matches(f, map.unitTests)) continue;
    if (matches(f, map.shared)) for (const code of Object.keys(map.components)) select(code, "shared input");
    for (const [code, c] of Object.entries(map.components)) {
      if (!matches(f, componentGlobs(c))) continue;
      select(code, "changed");
      if (matches(f, c.paths)) changedSource.add(code);
    }
    if (matches(f, map.e2e.app)) r.e2e.all = true;
  }
  for (const changed of changedSource) {
    for (const [code, c] of Object.entries(map.components)) if (c.dependsOn.includes(changed)) select(code, `depends on ${changed}`);
  }
  if (everything) {
    r.unit.all = true;
    r.e2e.all = true;
    for (const code of Object.keys(map.components)) select(code, "workflow change");
    for (const name of Object.keys(map.linters)) linters.add(name);
  }
  r.unit.files = r.unit.all ? [] : [...unitFiles].sort();
  r.e2e.specs = r.e2e.all ? [] : [...specs].sort();
  r.linters = [...linters].sort();
  for (const code of [...why.keys()].sort()) r.integration[code] = [...(why.get(code) ?? [])].sort();
  const selected = Object.keys(r.integration);
  r.chromium = r.e2e.all || r.e2e.specs.some((s) => map.e2e.ui.includes(s)) || selected.some((code) => map.components[code]?.browser === true);
  r.build = r.linters.includes("typecheck") || r.unit.all || r.unit.files.length > 0 || selected.length > 0 || r.e2e.all || r.e2e.specs.length > 0;
  return r;
}

/** The readable report CI prints; it starts with the line `Classification`. */
export function report(r) {
  const list = (xs) => (xs.length === 0 ? "none" : xs.join(", "));
  const files = (title, xs) => [`  ${title}: ${xs.length}`, ...xs.map((f) => `    ${f}`)];
  const lines = ["Classification", ...files("docs, specs and plans (no test)", r.docs), ...files("docs read by tests", r.testInputs), ...files("code and tests", r.code), "Selected layers"];
  lines.push(`  linters: ${list(r.linters)}`, `  build: ${r.build ? "yes" : "no"}`, `  unit: ${r.unit.all ? "all" : list(r.unit.files)}`);
  const comps = Object.entries(r.integration);
  lines.push(`  integration: ${comps.length === 0 ? "none" : ""}`, ...comps.map(([code, reasons]) => `    ${code}: ${reasons.join("; ")}`));
  lines.push(`  e2e: ${r.e2e.all ? "all (e2e-api, e2e-ui)" : list(r.e2e.specs)}`, `  chromium: ${r.chromium ? "yes" : "no"}`);
  return lines.join("\n");
}

// A criterion or scenario ID as a test tags it: `tag("KV-AC-001", …)`, `tag([…, "E2E-002"], …)` or `[KV-AC-001]`.
const TAG = /"((?:[A-Z]+-AC|E2E)-\d{3})"|\[((?:[A-Z]+-AC|E2E)-\d{3})\]/g;
const CRITERIA = "tests/compliance/criteria/";

function sourcesUnder(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return [];
  if (!statSync(abs).isDirectory()) return [rel];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" ? [] : sourcesUnder(root, `${rel}/${e.name}`)) : /\.(?:ts|mts|mjs)$/.test(e.name) ? [`${rel}/${e.name}`] : []));
}

/** The IDs tagged in the test sources under `paths`; unit tests are skipped (their IDs are data, not tags of this layer). */
export function tagsIn(root, paths) {
  const ids = new Set();
  for (const f of paths.flatMap((p) => sourcesUnder(root, p)).filter((f) => !f.endsWith(".unit.test.ts"))) {
    for (const m of readFileSync(join(root, f), "utf8").matchAll(TAG)) ids.add(m[1] ?? m[2]);
  }
  return ids;
}

/**
 * What the CI jobs run for a classification. The compliance harness (`npm run compliance -- --target local --only <ids>`)
 * runs every test tagged with `ids`, once, across the integration config and the Playwright projects: the criteria IDs
 * tagged under the selected components' integration directories plus every ID tagged in the selected e2e specs.
 * `direct` are the selected non-criteria integration directories. CI runs their tests with Vitest directly, except the
 * tests tagged with one of `ids` (`directFilter`), which the harness runs; so a test tagged only with an ID that is not
 * selected (for example an `E2E-nnn` tag on a framework suite) still runs once. Criteria always go through the
 * harness (P0). The harness selects by ID in every layer, so it also runs `alsoE2e` (unselected specs that carry a
 * selected integration ID) and `alsoIntegration` (integration test files that carry a selected e2e ID); DEC-0639.
 */
export function ciPlan(r, map, root = ROOT) {
  const dirs = Object.keys(r.integration).flatMap((code) => map.components[code]?.integration ?? []);
  const integrationIds = [...tagsIn(root, dirs)].filter((id) => id.includes("-AC-"));
  const allSpecs = sourcesUnder(root, "tests/compliance/e2e").filter((f) => matches(f, map.e2e.specs));
  const specs = r.e2e.all ? allSpecs : r.e2e.specs;
  const e2eIds = [...tagsIn(root, specs)];
  const ids = [...new Set([...integrationIds, ...e2eIds])].sort();
  const alsoE2e = allSpecs.filter((s) => !specs.includes(s) && [...tagsIn(root, [s])].some((id) => integrationIds.includes(id))).sort();
  const e2eOnly = e2eIds.filter((id) => !integrationIds.includes(id));
  const allDirs = Object.values(map.components).flatMap((c) => c.integration);
  const tests = allDirs.flatMap((d) => sourcesUnder(root, d)).filter((f) => /\.(?:test|spec)\.ts$/.test(f) && !f.endsWith(".unit.test.ts") && !dirs.some((d) => f.startsWith(`${d}/`)));
  const alsoIntegration = e2eOnly.length === 0 ? [] : tests.filter((f) => [...tagsIn(root, [f])].some((id) => e2eOnly.includes(id))).sort();
  return {
    unit: r.unit.all ? "all" : r.unit.files.length > 0 ? "files" : "none",
    unitFiles: r.unit.files,
    ids,
    direct: [...new Set(dirs.filter((d) => !d.startsWith(CRITERIA)))].sort(),
    alsoE2e,
    alsoIntegration,
    chromium: r.chromium || alsoE2e.some((s) => map.e2e.ui.includes(s)),
  };
}

/** Vitest `-t` pattern for the direct run: every test except those tagged with one of `ids` (the harness runs those). */
export function directFilter(ids) {
  return ids.length === 0 ? "" : `^(?!.*\\[(?:${ids.join("|")})\\])`;
}

/** The `$GITHUB_OUTPUT` lines of the classify job. */
export function githubOutput(p, r) {
  const lines = { build: r.build || p.ids.length > 0, linters: r.linters.join(" "), unit: p.unit, unit_files: p.unitFiles.join(" "), ids: p.ids.join(","), direct: p.direct.join(" "), direct_filter: directFilter(p.ids), chromium: p.chromium };
  return Object.entries(lines).map(([k, v]) => `${k}=${String(v)}`).join("\n") + "\n";
}

function planReport(p) {
  const list = (xs) => (xs.length === 0 ? "none" : xs.join(" "));
  return [
    "CI plan",
    `  compliance harness --only (${p.ids.length} IDs): ${list(p.ids)}`,
    `  integration tests run directly (all but those tagged with an --only ID): ${list(p.direct)}`,
    `  e2e specs the harness also runs for shared IDs: ${list(p.alsoE2e)}`,
    `  integration tests the harness also runs for e2e IDs: ${list(p.alsoIntegration)}`,
    `  chromium: ${p.chromium ? "yes" : "no"}`,
  ].join("\n");
}

/** Test files that more than one layer collects; `layers` maps a layer to the files it collects. */
export function duplicates(layers) {
  const owners = new Map();
  for (const [layer, files] of Object.entries(layers)) for (const f of new Set(files)) owners.set(f, [...(owners.get(f) ?? []), layer]);
  return [...owners].filter(([, ls]) => ls.length > 1).map(([file, ls]) => ({ file, layers: ls })).sort((a, b) => (a.file < b.file ? -1 : 1));
}

/** Every layer's files as its runner collects them: the two Vitest configs and each Playwright project. */
function collectLayers() {
  const json = (args) => JSON.parse(execFileSync("npx", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "inherit"] }));
  const vitest = (config) => json(["vitest", "list", "--config", config, "--filesOnly", "--json"]).map((e) => relative(ROOT, e.file));
  const layers = { unit: vitest("vitest.unit.config.ts"), integration: vitest("vitest.integration.config.ts") };
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) for (const t of spec.tests) (layers[`playwright ${t.projectName}`] ??= []).push(spec.file);
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of json(["playwright", "test", "--list", "--reporter=json"]).suites) walk(suite);
  return layers;
}

function changedFiles(base, head) {
  return execFileSync("git", ["diff", "--name-only", base, head], { cwd: ROOT, encoding: "utf8" }).split("\n").filter((l) => l !== "");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  if (args.includes("--check-duplicates")) {
    const layers = collectLayers();
    for (const [layer, files] of Object.entries(layers)) process.stdout.write(`${layer}: ${new Set(files).size} files\n`);
    const dups = duplicates(layers);
    for (const d of dups) process.stdout.write(`DUPLICATE ${d.file}: ${d.layers.join(", ")}\n`);
    process.stdout.write(dups.length === 0 ? "No test file is collected by two layers.\n" : `${dups.length} test files are collected by more than one layer.\n`);
    process.exit(dups.length === 0 ? 0 : 1);
  }
  const base = value("--base");
  const all = args.includes("--all");
  const files = all ? [] : args.includes("--files") ? args.slice(args.indexOf("--files") + 1).filter((a, i, rest) => !rest.slice(0, i + 1).some((x) => x.startsWith("--"))) : base === undefined ? undefined : changedFiles(base, value("--head") ?? "HEAD");
  if (files === undefined) {
    process.stderr.write("usage: classify.mjs (--base <rev> [--head <rev>] | --files <path>…) [--json] [--github-output <file>]\n");
    process.exit(2);
  }
  const map = loadMap();
  const result = classify(files, map, { everything: all });
  const plan = ciPlan(result, map);
  process.stdout.write(`${args.includes("--json") ? JSON.stringify({ ...result, plan }, null, 2) : `${report(result)}\n${planReport(plan)}`}\n`);
  const out = value("--github-output");
  if (out !== undefined) appendFileSync(out, githubOutput(plan, result));
}
