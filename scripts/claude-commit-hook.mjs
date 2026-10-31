#!/usr/bin/env node
// Claude Code commit hook (plan v0.2.0 §7a.2.5, TS-12, TS-18), registered in .claude/settings.json as a
// PreToolUse hook on Bash. It reads the hook input on stdin. When the command runs `git commit` in a checkout
// of this repository, it lints the files the commit will hold and blocks the commit (exit 2, problems on
// stderr) when a linter fails:
// - eslint on the JavaScript and TypeScript files;
// - typecheck: the projects of `npm run typecheck` that hold a TypeScript file (all three when a root
//   tsconfig changes), building the framework first for the harness project, which reads its dist;
// - the record lints (scripts/lint-records.mjs) on root-cause and test-review records.
// The files: the staged ones (records read from the index), plus those the command adds before committing
// (`git add <paths>`, `-A`, `-u`) and those `git commit -a` or `git commit <paths>` takes (read from the
// working tree). Committed files are never linted unless they are part of the commit.
// There is no git hook, so `--no-verify` does not skip this. Apps never get it (TS-18): the template has no hooks.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lintAll, recordKind } from "./lint-records.mjs";

// ---- Which commands commit: a small shell tokenizer, enough for the commands Claude writes ----

/** Words and operators of a shell command line; heredoc bodies and comments are dropped. */
function tokenize(src) {
  const tokens = [];
  let word = null;
  let expectDelim = null;
  const pending = [];
  const add = (s) => (word = (word ?? "") + s);
  const end = () => {
    if (word === null) return;
    if (expectDelim) {
      pending.push({ delim: word, strip: expectDelim.strip });
      expectDelim = null;
    } else tokens.push({ op: false, v: word });
    word = null;
  };
  const op = (v) => {
    end();
    tokens.push({ op: true, v });
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      const stop = j < 0 ? src.length : j;
      add(src.slice(i + 1, stop));
      i = stop + 1;
    } else if (c === '"') {
      // Double quotes; `$( … )` inside them may hold quotes and newlines, so count its parentheses.
      let s = "";
      let depth = 0;
      i++;
      while (i < src.length && (src[i] !== '"' || depth > 0)) {
        if (src[i] === "\\" && i + 1 < src.length && '"\\$`\n'.includes(src[i + 1])) {
          if (src[i + 1] !== "\n") s += src[i + 1];
          i += 2;
          continue;
        }
        if (src[i] === "$" && src[i + 1] === "(") depth++;
        else if (src[i] === ")" && depth > 0) depth--;
        s += src[i];
        i++;
      }
      add(s);
      i++;
    } else if (c === "\\") {
      if (next !== "\n" && next !== undefined) add(next);
      i += 2;
    } else if (c === " " || c === "\t" || c === "\r") {
      end();
      i++;
    } else if (c === "#" && word === null) {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "\n") {
      op(";");
      i++;
      for (const h of pending.splice(0)) {
        while (i < src.length) {
          const j = src.indexOf("\n", i);
          const line = src.slice(i, j < 0 ? src.length : j);
          i = j < 0 ? src.length : j + 1;
          if ((h.strip ? line.replace(/^\t+/, "") : line) === h.delim) break;
        }
      }
    } else if (c === "<" && next === "<" && src[i + 2] !== "<") {
      end();
      const strip = src[i + 2] === "-";
      expectDelim = { strip };
      i += strip ? 3 : 2;
    } else if (c === "&" && (next === ">" || (word !== null && /[<>]$/.test(word)))) {
      add(c);
      i++;
    } else if ((c === "&" || c === "|") && next === c) {
      op(c + c);
      i += 2;
    } else if (c === "$" && next === "(") {
      op("(");
      i += 2;
    } else if (";&|()`".includes(c)) {
      op(c);
      i++;
    } else {
      add(c);
      i++;
    }
  }
  end();
  return tokens;
}

/** Simple commands (word lists) without redirections. */
function simpleCommands(src) {
  const out = [];
  let cur = [];
  for (const t of tokenize(src)) {
    if (t.op) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(t.v);
  }
  if (cur.length) out.push(cur);
  return out.map((words) => {
    const kept = [];
    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      if (/^(?:\d*|&)(?:>>?|>\||<|<<<)$/.test(w)) k++; // operator alone: its target is the next word
      else if (!/^(?:\d*|&)(?:>>?|>\||<|>&|<&)\S/.test(w)) kept.push(w);
    }
    return kept;
  });
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WRAPPERS = new Set(["command", "builtin", "exec", "nohup", "time", "env"]);
const GIT_GLOBAL_WITH_VALUE = new Set(["-c", "--git-dir", "--work-tree", "--namespace", "--config-env"]);
const COMMIT_SHORT_WITH_VALUE = new Set(["m", "F", "C", "c", "t"]);
const COMMIT_LONG_WITH_VALUE = new Set(["--message", "--file", "--reuse-message", "--reedit-message", "--template", "--author", "--date", "--fixup", "--squash", "--cleanup", "--trailer", "--pathspec-from-file"]);

function commitArgs(args) {
  let all = false;
  const pathspecs = [];
  for (let k = 0; k < args.length; k++) {
    const w = args[k];
    if (w === "--") {
      pathspecs.push(...args.slice(k + 1));
      break;
    }
    if (w.startsWith("--")) {
      const name = w.split("=")[0];
      if (name === "--all") all = true;
      else if (COMMIT_LONG_WITH_VALUE.has(name) && !w.includes("=")) k++;
    } else if (w.startsWith("-") && w.length > 1) {
      for (let j = 1; j < w.length; j++) {
        const ch = w[j];
        if (ch === "a") all = true;
        else if (COMMIT_SHORT_WITH_VALUE.has(ch)) {
          if (j === w.length - 1) k++;
          break;
        } else if (ch === "u" || ch === "S") break; // optional value, attached
      }
    } else pathspecs.push(w);
  }
  return { all, pathspecs };
}

function addArgs(args) {
  let mode = "paths";
  const pathspecs = [];
  for (let k = 0; k < args.length; k++) {
    const w = args[k];
    if (w === "--") {
      pathspecs.push(...args.slice(k + 1));
      break;
    }
    if (w.startsWith("--")) {
      const name = w.split("=")[0];
      if (name === "--all" || name === "--no-ignore-removal") mode = "all";
      else if (name === "--update") mode = "update";
      else if (name === "--pathspec-from-file" && !w.includes("=")) k++;
    } else if (w.startsWith("-") && w.length > 1) {
      if (w.includes("A")) mode = "all";
      else if (w.includes("u")) mode = "update";
    } else pathspecs.push(w);
  }
  return { mode, pathspecs };
}

const expand = (p) => (p === "~" ? homedir() : p.startsWith("~/") ? homedir() + p.slice(1) : p);

function walk(src, state) {
  for (const words of simpleCommands(src)) {
    let k = 0;
    for (;;) {
      if (k < words.length && ASSIGNMENT.test(words[k])) k++;
      else if (k < words.length && WRAPPERS.has(words[k])) k++;
      else if (k > 0 && words[k - 1] === "env" && words[k]?.startsWith("-")) k++;
      else break;
    }
    const cmd = words[k];
    if (cmd === undefined) continue;
    const rest = words.slice(k + 1);
    if (cmd === "cd" || cmd === "pushd") {
      const dir = rest.find((w) => !w.startsWith("-") || w === "-");
      if (dir === undefined) state.cwd = homedir();
      else if (dir !== "-") state.cwd = resolve(state.cwd, expand(dir));
    } else if (["bash", "sh", "zsh"].includes(basename(cmd)) && rest[0] === "-c" && rest[1] !== undefined) {
      walk(rest[1], { ...state, cwd: state.cwd, events: state.events });
    } else if (basename(cmd) === "git") {
      let cwd = state.cwd;
      let j = 0;
      while (j < rest.length && rest[j].startsWith("-")) {
        if (rest[j] === "-C") {
          cwd = resolve(cwd, expand(rest[j + 1] ?? "."));
          j += 2;
        } else if (GIT_GLOBAL_WITH_VALUE.has(rest[j])) j += 2;
        else j++;
      }
      const sub = rest[j];
      const args = rest.slice(j + 1);
      if (sub === "commit") state.events.push({ kind: "commit", cwd, ...commitArgs(args) });
      else if (sub === "add" || sub === "stage") state.events.push({ kind: "add", cwd, ...addArgs(args) });
    }
  }
}

/**
 * The `git commit` invocations in a Bash command, each with its working directory, and the `git add`
 * invocations that run before the last of them. `cwd` is the directory the command starts in.
 */
export function commitPlan(command, cwd) {
  const state = { cwd, events: [] };
  walk(command, state);
  const last = state.events.map((e) => e.kind).lastIndexOf("commit");
  return {
    commits: state.events.filter((e) => e.kind === "commit").map(({ cwd: c, all, pathspecs }) => ({ cwd: c, all, pathspecs })),
    adds: state.events.slice(0, Math.max(last, 0)).filter((e) => e.kind === "add").map(({ cwd: c, mode, pathspecs }) => ({ cwd: c, mode, pathspecs })),
  };
}

// ---- What the commit holds, and the linters ----

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
const nul = (s) => s.split("\0").filter(Boolean);

function topOf(cwd) {
  try {
    return git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return null;
  }
}

/** Repository-relative path → where to read it ("index" or "worktree"), for one repository. */
function commitFiles(top, commits, adds) {
  const files = new Map();
  for (const p of nul(git(top, ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]))) files.set(p, "index");
  const fromTree = (cwd, args) => {
    let out;
    try {
      out = git(cwd, ["ls-files", "-z", "--full-name", ...args]);
    } catch {
      return; // a pathspec git itself would refuse
    }
    for (const p of nul(out)) if (existsSync(join(top, p))) files.set(p, "worktree");
  };
  for (const c of commits) {
    if (c.all) fromTree(top, ["--modified"]);
    if (c.pathspecs.length) fromTree(c.cwd, ["--modified", "--", ...c.pathspecs]);
  }
  for (const a of adds) {
    const specs = a.pathspecs.length ? a.pathspecs : a.mode === "paths" ? null : [":/"];
    if (!specs) continue;
    fromTree(a.cwd, a.mode === "update" ? ["--modified", "--", ...specs] : ["--modified", "--others", "--exclude-standard", "--", ...specs]);
  }
  return files;
}

const LINTED = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const TYPED = /\.(?:[cm]?ts|tsx)$/;
/** The projects of `npm run typecheck`, in its order, with the files each includes. */
const PROJECTS = [
  { project: "packages/framework/tsconfig.json", has: (p) => /^packages\/framework\/(?:src|test)\//.test(p) },
  { project: "tsconfig.json", has: (p) => /^[^/]+\.config\.ts$/.test(p) || /^tests\/(?:support|skill)\//.test(p) },
  { project: "tests/compliance/harness/tsconfig.json", has: (p) => /^tests\/compliance\/(?:harness|tools|criteria|e2e)\//.test(p), build: true },
];
const SHARED_TSCONFIG = (p) => /^tsconfig[^/]*\.json$/.test(p) || PROJECTS.some((x) => x.project === p);

const clip = (s, n = 150) => {
  const lines = s.trimEnd().split("\n");
  return lines.length > n ? [...lines.slice(0, n), `… ${lines.length - n} more lines`].join("\n") : lines.join("\n");
};

function lintRepo(top, files, run) {
  const problems = [];
  const paths = [...files.keys()].filter((p) => existsSync(join(top, p))).sort();
  const bin = (rel, name) => {
    const b = join(top, rel);
    if (existsSync(b)) return b;
    problems.push(`${name} is not installed in ${top}: run npm ci there, then commit again.`);
    return null;
  };

  const js = paths.filter((p) => LINTED.test(p));
  if (js.length) {
    const eslint = bin("node_modules/eslint/bin/eslint.js", "eslint");
    if (eslint) {
      const r = run(process.execPath, [eslint, "--no-warn-ignored", ...js], top);
      if (r.status !== 0) problems.push(`eslint failed:\n${clip(r.output)}`);
    }
  }

  const everything = paths.some(SHARED_TSCONFIG);
  const projects = PROJECTS.filter((x) => everything || paths.some((p) => TYPED.test(p) && x.has(p)));
  if (projects.length) {
    const tsc = bin("node_modules/typescript/bin/tsc", "typescript");
    for (const x of tsc ? projects : []) {
      if (x.build) {
        const b = run("npm", ["run", "build", "-w", "packages/framework"], top);
        if (b.status !== 0) {
          problems.push(`the framework build failed (the typecheck of ${x.project} reads its dist):\n${clip(b.output)}`);
          continue;
        }
      }
      const r = run(process.execPath, [tsc, "-p", x.project], top);
      if (r.status !== 0) problems.push(`typecheck failed (tsc -p ${x.project}):\n${clip(r.output)}`);
    }
  }

  const records = paths.filter((p) => recordKind(p)).map((p) => ({ path: p, text: files.get(p) === "index" ? git(top, ["show", `:${p}`]) : readFileSync(join(top, p), "utf8"), top }));
  const recordProblems = lintAll(records);
  if (recordProblems.length) problems.push(`record lint failed (plan v0.2.0 §7a.1.8, §7a.1.9; ai/implementation/test-reviews/README.md):\n${recordProblems.map((p) => `  ${p}`).join("\n")}`);
  return problems;
}

function spawnRun(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? 1, output: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? r.error.message : ""}` };
}

/**
 * The hook's decision for one PreToolUse input: `{ code: 0 }` lets the command run, `{ code: 2, stderr }`
 * blocks it. `run(cmd, args, cwd)` runs eslint, tsc and the build (injectable for tests).
 */
export function runHook(input, { run = spawnRun } = {}) {
  const pass = { code: 0, stderr: "" };
  const command = input?.tool_name === "Bash" ? input.tool_input?.command : undefined;
  if (typeof command !== "string") return pass;
  const plan = commitPlan(command, input.cwd ?? process.cwd());
  if (plan.commits.length === 0) return pass;
  try {
    const repos = new Map();
    for (const c of plan.commits) {
      const top = topOf(c.cwd);
      // Only checkouts of this repository (TS-18); a commit in any other repository is not checked.
      if (!top || !existsSync(join(top, "scripts", "claude-commit-hook.mjs"))) continue;
      if (!repos.has(top)) repos.set(top, []);
      repos.get(top).push(c);
    }
    const problems = [];
    for (const [top, commits] of repos) {
      const adds = plan.adds.filter((a) => topOf(a.cwd) === top);
      problems.push(...lintRepo(top, commitFiles(top, commits, adds), run));
    }
    if (problems.length === 0) return pass;
    return {
      code: 2,
      stderr: `Commit blocked by the commit hook (.claude/settings.json, scripts/claude-commit-hook.mjs; plan v0.2.0 §7a.2.5).\nFix these, stage the fixes, and commit again:\n\n${problems.join("\n\n")}\n`,
    };
  } catch (e) {
    // Fail closed: a commit is never let through unchecked.
    return { code: 2, stderr: `Commit blocked: the commit hook (scripts/claude-commit-hook.mjs) failed: ${e instanceof Error ? e.message : String(e)}\n` };
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return 0; // not a hook input
  }
  const r = runHook(input);
  if (r.stderr) process.stderr.write(r.stderr);
  return r.code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
