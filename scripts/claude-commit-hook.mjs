#!/usr/bin/env node
// Claude Code commit hook (plan v0.2.0 §7a.2.5, TS-12, TS-18), registered in .claude/settings.json as a
// PreToolUse hook on Bash. It reads the hook input on stdin. When the command runs `git commit` in a checkout
// of this repository, it lints the files the commit will hold and blocks the commit (exit 2, problems on
// stderr) when a linter fails:
// - eslint on the JavaScript and TypeScript files;
// - typecheck: the projects of `npm run typecheck` that hold a TypeScript file (all three when a root
//   tsconfig changes; the harness project also when framework source changes), building the framework first
//   for the harness project, which reads its dist;
// - the record lints (scripts/lint-records.mjs) on root-cause and test-review records.
// The files: the staged ones (records read from the index), plus those the command adds before committing
// (`git add <paths>`, `-A`, `-u`, `-f`, `--pathspec-from-file`) and those `git commit -a` or
// `git commit <paths>` takes (read from the working tree). Committed files are never linted unless they are
// part of the commit. It fails closed: a commit whose directory cannot be known (`cd "$(…)"`) is checked in the
// session's own repository with its pathspecs read against the whole tree; a command word it cannot resolve
// followed by `commit` (`$g commit`) counts as a commit; git aliases for commit (`git ci`) are looked up.
// There is no git hook, so `--no-verify` does not skip this. Apps never get it (TS-18): the template has no hooks.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lintAll, recordKind } from "./lint-records.mjs";

// ---- Which commands commit: a small shell tokenizer, enough for the commands Claude writes ----

/** The end (exclusive) of the `( … )` span whose `(` is at `i`, counting parentheses and skipping single quotes. */
function substitutionEnd(src, i) {
  let depth = 0;
  let k = i;
  while (k < src.length) {
    const c = src[k];
    if (c === "'") k = (src.indexOf("'", k + 1) + 1 || src.length + 1) - 1;
    else if (c === "\\") k++;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return k + 1;
    k++;
  }
  return src.length;
}

/**
 * Words and operators of a shell command line; heredoc bodies and comments are dropped. `$( … )` and
 * backtick spans stay inside their word, unexpanded.
 */
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
          if (src[i + 1] !== "\n") s += src[i + 1] === "$" || src[i + 1] === "`" ? `\\${src[i + 1]}` : src[i + 1];
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
      if (next !== "\n" && next !== undefined) add(next === "$" || next === "`" ? `\\${next}` : next);
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
    } else if (c === "<" && next === "<" && src[i + 2] === "<") {
      end();
      tokens.push({ op: false, v: "<<<" });
      i += 3;
    } else if (c === "<" && next === "<") {
      end();
      const strip = src[i + 2] === "-";
      expectDelim = { strip };
      i += strip ? 3 : 2;
    } else if (c === "$" && next === "(") {
      const stop = substitutionEnd(src, i + 1);
      add(src.slice(i, stop));
      i = stop;
    } else if (c === "`") {
      const j = src.indexOf("`", i + 1);
      const stop = j < 0 ? src.length : j + 1;
      add(src.slice(i, stop));
      i = stop;
    } else if (c === "&" && (next === ">" || (word !== null && /[<>]$/.test(word)))) {
      add(c);
      i++;
    } else if ((c === "&" || c === "|") && next === c) {
      op(c + c);
      i += 2;
    } else if (";&|()".includes(c)) {
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

/** Simple commands (word lists, without redirections) and the subshell brackets `(` and `)` between them. */
function commands(src) {
  const out = [];
  let cur = [];
  const flush = () => {
    if (cur.length) out.push(cur);
    cur = [];
  };
  for (const t of tokenize(src)) {
    if (!t.op) cur.push(t.v);
    else {
      flush();
      if (t.v === "(" || t.v === ")") out.push(t.v);
    }
  }
  flush();
  return out.map((words) => {
    if (typeof words === "string") return words;
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
const RESERVED = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until", "case", "esac", "{", "}", "!", "function", "select"]);
/** Command wrappers: the options that take a separate value, and how many plain arguments precede the command. */
const WRAPPERS = new Map([
  ["command", { values: [], args: 0 }],
  ["builtin", { values: [], args: 0 }],
  ["exec", { values: ["-a"], args: 0 }],
  ["nohup", { values: [], args: 0 }],
  ["time", { values: ["-f", "-o"], args: 0 }],
  ["env", { values: ["-u", "--unset", "-C", "--chdir", "-S", "--split-string"], args: 0 }],
  ["timeout", { values: ["-s", "--signal", "-k", "--kill-after"], args: 1 }],
  ["sudo", { values: ["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U", "-T"], args: 0 }],
  ["nice", { values: ["-n", "--adjustment"], args: 0 }],
  ["ionice", { values: ["-c", "-n", "-p", "-P", "-u"], args: 0 }],
  ["stdbuf", { values: ["-i", "-o", "-e"], args: 0 }],
  ["xargs", { values: ["-I", "-i", "-n", "-L", "-P", "-d", "-E", "-s", "-a", "--arg-file", "--delimiter", "--max-args", "--max-procs"], args: 0 }],
]);
const GIT_GLOBAL_WITH_VALUE = new Set(["-c", "--git-dir", "--work-tree", "--namespace", "--config-env"]);
/** git's own subcommands (never aliases, which git does not allow to shadow them): no alias lookup for these. */
const GIT_BUILTINS = new Set(
  ("add am annotate apply archive bisect blame branch bundle cat-file check-ignore checkout cherry cherry-pick clean clone commit-tree config " +
    "count-objects credential describe diff diff-files diff-index diff-tree difftool fetch format-patch fsck gc grep hash-object help init " +
    "log ls-files ls-remote ls-tree maintenance merge merge-base mergetool mv notes pull push range-diff read-tree rebase reflog remote repack " +
    "replace reset restore rev-list rev-parse revert rm shortlog show show-ref sparse-checkout stash status submodule switch symbolic-ref tag " +
    "update-index update-ref var verify-commit version whatchanged worktree write-tree lfs").split(" "),
);
const COMMIT_SHORT_WITH_VALUE = new Set(["m", "F", "C", "c", "t"]);
const COMMIT_LONG_WITH_VALUE = new Set(["--message", "--file", "--reuse-message", "--reedit-message", "--template", "--author", "--date", "--fixup", "--squash", "--cleanup", "--trailer"]);

/** A word with `$NAME` / `${NAME}` and `~` expanded from `env`; null when it cannot be known statically. */
function expandWord(w, env) {
  if (/\\?`|\$\(/.test(w)) return null;
  let unknown = false;
  const out = w.replace(/\\\$|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)|\$./g, (m, a, b) => {
    if (m === "\\$") return "$";
    const name = a ?? b;
    if (name === undefined || env[name] === undefined) unknown = true;
    return name === undefined ? m : (env[name] ?? "");
  });
  if (unknown) return null;
  return out === "~" ? homedir() : out.startsWith("~/") ? homedir() + out.slice(1) : out;
}
const dynamic = (w) => /(?<!\\)\$|`/.test(w);
const at = (cwd, dir, env) => {
  const d = expandWord(dir, env);
  if (d === null) return null;
  if (d.startsWith("/")) return resolve(d);
  return cwd === null ? null : resolve(cwd, d);
};
const fromFile = (cwd, w, env) => at(cwd, w, env) ?? null;

function commitArgs(args, cwd, env) {
  let all = false;
  let pathspecFile;
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
      else if (name === "--pathspec-from-file") {
        pathspecFile = fromFile(cwd, w.includes("=") ? w.slice(w.indexOf("=") + 1) : (args[++k] ?? ""), env);
      } else if (COMMIT_LONG_WITH_VALUE.has(name) && !w.includes("=")) k++;
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
  return { all, pathspecs: pathspecs.some(dynamic) ? [":/"] : pathspecs, pathspecFile };
}

function addArgs(args, cwd, env) {
  let mode = "paths";
  let force;
  let pathspecFile;
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
      else if (name === "--force") force = true;
      else if (name === "--pathspec-from-file") pathspecFile = fromFile(cwd, w.includes("=") ? w.slice(w.indexOf("=") + 1) : (args[++k] ?? ""), env);
    } else if (w.startsWith("-") && w.length > 1) {
      if (w.includes("A")) mode = "all";
      else if (w.includes("u")) mode = "update";
      if (w.includes("f")) force = true;
    } else pathspecs.push(w);
  }
  if (pathspecs.some(dynamic)) return { mode: "all", pathspecs: [":/"], force, pathspecFile };
  return { mode, pathspecs, force, pathspecFile };
}

/** Index of the first word after any assignments, reserved words and wrappers (with their options). */
function commandStart(words) {
  let k = 0;
  while (k < words.length) {
    const w = words[k];
    if (ASSIGNMENT.test(w) || RESERVED.has(w)) {
      k++;
      continue;
    }
    const wrap = WRAPPERS.get(basename(w));
    if (!wrap) break;
    k++;
    let plain = wrap.args;
    while (k < words.length) {
      const o = words[k];
      if (o === "--") {
        k++;
        break;
      }
      if (o.startsWith("-") && o.length > 1) {
        k += wrap.values.includes(o) ? 2 : 1;
      } else if (basename(w) === "env" && ASSIGNMENT.test(o)) k++;
      else if (plain > 0) {
        plain--;
        k++;
      } else break;
    }
  }
  return k;
}

/** The bodies of the unescaped `$( … )` and backtick spans in a word. */
function substitutions(word) {
  const out = [];
  for (let i = 0; i < word.length; i++) {
    if (word[i] === "\\") i++;
    else if (word[i] === "$" && word[i + 1] === "(") {
      const stop = substitutionEnd(word, i + 1);
      out.push(word.slice(i + 2, Math.max(i + 2, stop - 1)));
      i = stop - 1;
    } else if (word[i] === "`") {
      const j = word.indexOf("`", i + 1);
      if (j < 0) break;
      out.push(word.slice(i + 1, j));
      i = j;
    }
  }
  return out;
}

/** Splits `git` arguments into the global options (directory, inline aliases), the subcommand and its arguments. */
function gitWords(rest, cwd, env) {
  let j = 0;
  const inline = {};
  while (j < rest.length && rest[j].startsWith("-")) {
    if (rest[j] === "-C") {
      cwd = at(cwd, rest[j + 1] ?? ".", env);
      j += 2;
    } else if (GIT_GLOBAL_WITH_VALUE.has(rest[j])) {
      const a = rest[j] === "-c" ? /^alias\.([^=]+)=(.*)$/s.exec(rest[j + 1] ?? "") : null;
      if (a) inline[a[1]] = a[2];
      j += 2;
    } else j++;
  }
  return { cwd, inline, sub: rest[j], args: rest.slice(j + 1) };
}

function gitCommand(rest, state) {
  const { cwd, inline, sub, args } = gitWords(rest, state.cwd, state.env);
  if (sub === undefined) return;
  // A subcommand that cannot be resolved (`git "$(echo commit)"`) is read as commit.
  if (sub === "commit" || dynamic(sub)) state.events.push({ kind: "commit", cwd, ...commitArgs(args, cwd, state.env) });
  else if (sub === "add" || sub === "stage") state.events.push({ kind: "add", cwd, ...addArgs(args, cwd, state.env) });
  else if (!GIT_BUILTINS.has(sub)) state.events.push({ kind: "other", cwd, sub, args, inline });
}

function walk(src, state) {
  const subshells = [];
  for (const item of commands(src)) {
    if (item === "(") {
      subshells.push(state.cwd);
      continue;
    }
    if (item === ")") {
      if (subshells.length) state.cwd = subshells.pop();
      continue;
    }
    // Command substitutions run first, in a subshell: walk them with their own directory.
    for (const body of item.flatMap(substitutions)) walk(body, { ...state, dirs: [] });
    const k = commandStart(item);
    const cmd = item[k];
    if (cmd === undefined) continue;
    const rest = item.slice(k + 1);
    const name = basename(cmd);
    if (dynamic(cmd)) {
      // A command word that cannot be resolved (`$g commit`, `$(which git) commit`): read it as a commit.
      const c = rest.indexOf("commit");
      if (c >= 0) state.events.push({ kind: "commit", cwd: state.cwd, ...commitArgs(rest.slice(c + 1), state.cwd, state.env) });
    } else if (cmd === "cd" || cmd === "pushd") {
      const dir = rest.find((w) => !w.startsWith("-") || w === "-");
      if (cmd === "pushd") state.dirs.push(state.cwd);
      if (dir === undefined) state.cwd = homedir();
      else if (dir !== "-") state.cwd = at(state.cwd, dir, state.env);
    } else if (cmd === "popd") {
      if (state.dirs.length) state.cwd = state.dirs.pop();
    } else if (cmd === "eval") {
      walk(rest.join(" "), state);
    } else if (["bash", "sh", "zsh", "dash"].includes(name) && rest[0] === "-c" && rest[1] !== undefined) {
      const inner = { ...state, dirs: [] };
      walk(rest[1], inner);
    } else if (name === "git") {
      gitCommand(rest, state);
    } else {
      // git as an argument of another command (`watch git commit`, `find -exec git commit`, `parallel git commit`).
      const g = rest.findIndex((w) => basename(w) === "git");
      if (g >= 0) gitCommand(rest.slice(g + 1), state);
    }
  }
}

/**
 * The `git commit` invocations in a Bash command, each with its working directory (null when it cannot be
 * known statically), and the `git add` invocations that run before the last of them. `cwd` is the directory
 * the command starts in; `env` expands `$NAME` in directories.
 */
export function commitPlan(command, cwd, env = process.env) {
  const state = { cwd, env, dirs: [], events: [] };
  walk(command, state);
  const last = state.events.reduce((n, e, i) => (e.kind === "commit" || e.kind === "other" ? i : n), -1);
  return {
    commits: state.events.filter((e) => e.kind === "commit").map(({ cwd: c, all, pathspecs, pathspecFile }) => ({ cwd: c, all, pathspecs, pathspecFile })),
    adds: state.events
      .slice(0, Math.max(last, 0))
      .filter((e) => e.kind === "add")
      .map(({ cwd: c, mode, pathspecs, force, pathspecFile }) => ({ cwd: c, mode, pathspecs, force, pathspecFile })),
    // Subcommands that are not git built-ins, which may be aliases for commit (resolved by runHook).
    others: state.events.filter((e) => e.kind === "other").map(({ cwd: c, sub, args, inline }) => ({ cwd: c, sub, args, inline })),
  };
}

/**
 * The commit a git alias stands for, or null. An alias may set options before its subcommand and may name
 * another alias (followed up to 3 levels). A shell alias (`!…`) that mentions commit counts as `commit -a`.
 */
function aliasCommit(o, top, depth = 0) {
  let value = o.inline[o.sub];
  if (value === undefined && top) {
    try {
      value = git(top, ["config", "--get", `alias.${o.sub}`]).trim();
    } catch {
      value = undefined;
    }
  }
  if (!value) return null;
  if (value.startsWith("!")) return /\bcommit\b/.test(value) ? { cwd: o.cwd, all: true, pathspecs: [] } : null;
  const { sub, args } = gitWords(value.split(/\s+/).filter(Boolean), o.cwd, {});
  if (sub === "commit") return { cwd: o.cwd, ...commitArgs([...args, ...o.args], o.cwd, {}) };
  if (sub === undefined || GIT_BUILTINS.has(sub) || sub === "add" || depth >= 2) return null;
  return aliasCommit({ ...o, sub, args: [...args, ...o.args] }, top, depth + 1);
}

// ---- What the commit holds, and the linters ----

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
const nul = (s) => s.split("\0").filter(Boolean);

function topOf(cwd) {
  if (cwd === null || !existsSync(cwd)) return null;
  try {
    return git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return null;
  }
}

/** The pathspecs in a `--pathspec-from-file` file (one per line); [] when it cannot be read. */
function pathspecsFrom(file) {
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\0|\r?\n/)
    .filter(Boolean);
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
      return; // a pathspec git itself would refuse (the directory is known to exist here)
    }
    for (const p of nul(out)) if (existsSync(join(top, p))) files.set(p, "worktree");
  };
  const known = (cwd) => cwd !== null && existsSync(cwd);
  /** The pathspecs to read: the whole tree when they are relative to a directory that cannot be known. */
  const specsOf = (x) => {
    const given = x.pathspecs.length > 0 || x.pathspecFile !== undefined;
    if (!given) return [];
    if (!known(x.cwd) || x.pathspecFile === null) return [":/"];
    return [...x.pathspecs, ...pathspecsFrom(x.pathspecFile)];
  };
  for (const c of commits) {
    if (c.all) fromTree(top, ["--modified"]);
    const specs = specsOf(c);
    if (specs.length) fromTree(known(c.cwd) ? c.cwd : top, ["--modified", "--", ...specs]);
  }
  for (const a of adds) {
    const given = specsOf(a);
    const specs = given.length ? given : a.mode === "paths" ? null : [":/"];
    if (!specs) continue;
    const cwd = known(a.cwd) ? a.cwd : top;
    if (a.mode === "update") fromTree(cwd, ["--modified", "--", ...specs]);
    else fromTree(cwd, ["--modified", "--others", ...(a.force ? [] : ["--exclude-standard"]), "--", ...specs]);
  }
  return files;
}

const LINTED = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const TYPED = /\.(?:[cm]?ts|tsx)$/;
const FRAMEWORK_SOURCE = (p) => /^packages\/framework\/src\//.test(p);
/** The projects of `npm run typecheck`, in its order, with the files each depends on. */
const PROJECTS = [
  { project: "packages/framework/tsconfig.json", has: (p) => /^packages\/framework\/(?:src|test)\//.test(p) },
  { project: "tsconfig.json", has: (p) => /^[^/]+\.config\.ts$/.test(p) || /^tests\/(?:support|skill)\//.test(p) },
  // Reads the framework through its built dist, so framework source changes concern it too.
  { project: "tests/compliance/harness/tsconfig.json", has: (p) => /^tests\/compliance\/(?:harness|tools|criteria|e2e)\//.test(p) || FRAMEWORK_SOURCE(p), build: true },
];
const SHARED_TSCONFIG = (p) => /^tsconfig[^/]*\.json$/.test(p) || PROJECTS.some((x) => x.project === p);

const clip = (s, n = 150) => {
  const lines = s.trimEnd().split("\n");
  return lines.length > n ? [...lines.slice(0, n), `… ${lines.length - n} more lines`].join("\n") : lines.join("\n");
};

/** The hook's own time limit, below the 300 s timeout in .claude/settings.json, so a slow check blocks instead of timing out. */
export const BUDGET_MS = 280_000;

function lintRepo(top, files, run, deadline) {
  const problems = [];
  const paths = [...files.keys()].filter((p) => existsSync(join(top, p))).sort();
  const bin = (rel, name) => {
    const b = join(top, rel);
    if (existsSync(b)) return b;
    problems.push(`${name} is not installed in ${top}: run npm ci there, then commit again.`);
    return null;
  };
  const step = (what, cmd, args) => {
    const left = deadline - Date.now();
    if (left <= 0) return { status: 1, output: `the commit hook ran out of time (${BUDGET_MS / 1000} s) before ${what}; run it by hand: ${[cmd, ...args].join(" ")}` };
    return run(cmd, args, top, left);
  };

  const js = paths.filter((p) => LINTED.test(p));
  if (js.length) {
    const eslint = bin("node_modules/eslint/bin/eslint.js", "eslint");
    if (eslint) {
      const r = step("eslint", process.execPath, [eslint, "--no-warn-ignored", ...js]);
      if (r.status !== 0) problems.push(`eslint failed:\n${clip(r.output)}`);
    }
  }

  const everything = paths.some(SHARED_TSCONFIG);
  const projects = PROJECTS.filter((x) => everything || paths.some((p) => TYPED.test(p) && x.has(p)));
  if (projects.length) {
    const tsc = bin("node_modules/typescript/bin/tsc", "typescript");
    for (const x of tsc ? projects : []) {
      if (x.build) {
        const b = step("the framework build", "npm", ["run", "build", "-w", "packages/framework"]);
        if (b.status !== 0) {
          problems.push(`the framework build failed (the typecheck of ${x.project} reads its dist):\n${clip(b.output)}`);
          continue;
        }
      }
      const r = step(`tsc -p ${x.project}`, process.execPath, [tsc, "-p", x.project]);
      if (r.status !== 0) problems.push(`typecheck failed (tsc -p ${x.project}):\n${clip(r.output)}`);
    }
  }

  const records = paths.filter((p) => recordKind(p)).map((p) => ({ path: p, text: files.get(p) === "index" ? git(top, ["show", `:${p}`]) : readFileSync(join(top, p), "utf8"), top }));
  const recordProblems = lintAll(records);
  if (recordProblems.length) problems.push(`record lint failed (plan v0.2.0 §7a.1.8, §7a.1.9; ai/implementation/test-reviews/README.md):\n${recordProblems.map((p) => `  ${p}`).join("\n")}`);
  return problems;
}

function spawnRun(cmd, args, cwd, timeoutMs) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, killSignal: "SIGKILL" });
  const timedOut = r.error?.code === "ETIMEDOUT" || (r.status === null && r.signal === "SIGKILL");
  const tail = timedOut ? `\nthe commit hook ran out of time (${BUDGET_MS / 1000} s) in: ${[cmd, ...args].join(" ")}` : r.error ? r.error.message : "";
  return { status: timedOut ? 1 : (r.status ?? 1), output: `${r.stdout ?? ""}${r.stderr ?? ""}${tail}` };
}

/**
 * The hook's decision for one PreToolUse input: `{ code: 0 }` lets the command run, `{ code: 2, stderr }`
 * blocks it. `run(cmd, args, cwd, timeoutMs)` runs eslint, tsc and the build (injectable for tests); `env`
 * expands variables in the command's directories; `budgetMs` is the hook's own time limit.
 */
export function runHook(input, { run = spawnRun, env = process.env, budgetMs = BUDGET_MS } = {}) {
  const pass = { code: 0, stderr: "" };
  const command = input?.tool_name === "Bash" ? input.tool_input?.command : undefined;
  if (typeof command !== "string") return pass;
  const start = input.cwd ?? process.cwd();
  const plan = commitPlan(command, start, env);
  if (plan.commits.length === 0 && plan.others.length === 0) return pass;
  const deadline = Date.now() + budgetMs;
  try {
    // Aliases for commit (`git ci`), looked up in the repository the subcommand runs in.
    const commits = [...plan.commits, ...plan.others.map((o) => aliasCommit(o, topOf(o.cwd) ?? topOf(start))).filter(Boolean)];
    if (commits.length === 0) return pass;
    const repos = new Map();
    for (const c of commits) {
      // A directory that cannot be known, or is not in a repository, falls back to the session's repository.
      const top = topOf(c.cwd) ?? topOf(start);
      // Only checkouts of this repository (TS-18); a commit in any other repository is not checked.
      if (!top || !existsSync(join(top, "scripts", "claude-commit-hook.mjs"))) continue;
      if (!repos.has(top)) repos.set(top, []);
      repos.get(top).push(c);
    }
    const problems = [];
    for (const [top, list] of repos) {
      const adds = plan.adds.filter((a) => (topOf(a.cwd) ?? topOf(start)) === top);
      problems.push(...lintRepo(top, commitFiles(top, list, adds), run, deadline));
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
