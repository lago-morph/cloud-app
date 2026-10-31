// Unit tests for the Claude Code commit hook scripts/claude-commit-hook.mjs and its registration in
// .claude/settings.json (plan v0.2.0 §7a.2.5, TS-12, TS-18): a PreToolUse hook on Bash that, when the
// command runs `git commit`, lints the files the commit will hold and blocks the commit (exit 2) on a failure.
// eslint, tsc and the build are replaced by a recording runner here; git runs for real in temporary repositories.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { commitPlan, runHook } from "../scripts/claude-commit-hook.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(REPO, "scripts", "claude-commit-hook.mjs");

describe("commitPlan: which commands commit, and what they add first", () => {
  const plan = (command: string, cwd = "/base") => commitPlan(command, cwd);

  it("finds no commit in commands that do not run git commit", () => {
    for (const c of ["git status", "echo 'git commit'", 'grep "git commit" x', "git commit-tree HEAD^{tree}", "git log --grep=commit", "ls # git commit", ""]) {
      expect(plan(c).commits, c).toEqual([]);
    }
  });

  it("finds a plain commit and its working directory", () => {
    expect(plan("git commit -m x").commits).toEqual([{ cwd: "/base", all: false, pathspecs: [] }]);
    expect(plan("/usr/bin/git commit --amend --no-edit").commits).toHaveLength(1);
    expect(plan("FOO=1 env BAR=2 git -c user.name=x --no-pager commit -q").commits).toHaveLength(1);
  });

  it("does not split a quoted message on operators, and keeps -m's value out of the pathspecs", () => {
    expect(plan('git commit -m "a && git push; b" && echo ok').commits).toEqual([{ cwd: "/base", all: false, pathspecs: [] }]);
    expect(plan("git commit -am 'msg with spaces'").commits).toEqual([{ cwd: "/base", all: true, pathspecs: [] }]);
    expect(plan("git commit --message=foo --author 'A <a@example.invalid>'").commits[0]?.pathspecs).toEqual([]);
    expect(plan('git commit -m "$(cat <<\'EOF\'\nsubject\n\ncd /elsewhere\nEOF\n)"').commits).toEqual([{ cwd: "/base", all: false, pathspecs: [] }]);
  });

  it("collects pathspecs given to commit, and -a / --all", () => {
    expect(plan("git commit a.ts -m x -- b.ts").commits[0]?.pathspecs).toEqual(["a.ts", "b.ts"]);
    expect(plan("git commit --all -m x").commits[0]?.all).toBe(true);
    expect(plan("git commit -m x 2>&1 | tail -3").commits[0]?.pathspecs).toEqual([]);
    expect(plan("git commit -m x > /dev/null 2> err.txt").commits[0]?.pathspecs).toEqual([]);
  });

  it("follows cd and git -C to the commit's directory", () => {
    expect(plan("cd /repo && git commit -m x").commits[0]?.cwd).toBe("/repo");
    expect(plan("cd sub; git -C ../other commit -m x").commits[0]?.cwd).toBe("/base/other");
    expect(plan("git -C /a -C b commit").commits[0]?.cwd).toBe("/a/b");
  });

  it("records git add before the commit: pathspecs, -A and -u", () => {
    expect(plan("git add a.md 'b c.md' && git commit -m x").adds).toEqual([{ cwd: "/base", mode: "paths", pathspecs: ["a.md", "b c.md"] }]);
    expect(plan("git add -A && git commit -m x").adds).toEqual([{ cwd: "/base", mode: "all", pathspecs: [] }]);
    expect(plan("git add --update && git commit -m x").adds).toEqual([{ cwd: "/base", mode: "update", pathspecs: [] }]);
    expect(plan("cd /r && git stage . && git commit -m x").adds).toEqual([{ cwd: "/r", mode: "paths", pathspecs: ["."] }]);
    expect(plan("git commit -m x && git add later.md").adds).toEqual([]);
  });

  it("does not read a heredoc body as commands", () => {
    const p = plan("git commit -F - <<'EOF'\ncd /elsewhere\ngit add evil.md\nEOF\necho done");
    expect(p.commits).toEqual([{ cwd: "/base", all: false, pathspecs: [] }]);
    expect(p.adds).toEqual([]);
  });

  it("looks inside bash -c / sh -c", () => {
    expect(plan("bash -c 'cd /r && git commit -m x'").commits[0]?.cwd).toBe("/r");
  });

  it("expands environment variables in cd and git -C, and marks a directory it cannot know as null", () => {
    const env = { D: "/r" };
    expect(commitPlan('cd "$D" && git commit -m x', "/base", env).commits[0]?.cwd).toBe("/r");
    expect(commitPlan("cd ${D}/sub && git commit -m x", "/base", env).commits[0]?.cwd).toBe("/r/sub");
    expect(commitPlan("cd $UNSET && git commit -m x", "/base", env).commits[0]?.cwd).toBeNull();
    expect(commitPlan('git -C "$(pwd)" commit -m x', "/base", env).commits[0]?.cwd).toBeNull();
    expect(commitPlan("cd $(git rev-parse --show-toplevel) && git commit -m x", "/base", env).commits[0]?.cwd).toBeNull();
    expect(commitPlan("cd `pwd` && git commit -m x", "/base", env).commits[0]?.cwd).toBeNull();
    expect(commitPlan('cd "$(pwd)" && cd /abs && git commit -m x', "/base", env).commits[0]?.cwd).toBe("/abs");
  });

  it("restores the directory after a subshell and on popd", () => {
    expect(plan("(cd /tmp && ls) && git commit -m x").commits[0]?.cwd).toBe("/base");
    expect(plan("pushd /tmp && popd && git commit -m x").commits[0]?.cwd).toBe("/base");
    expect(plan("pushd /a; pushd /b; popd; git commit -m x").commits[0]?.cwd).toBe("/a");
  });

  it("sees commands behind shell keywords, braces and !", () => {
    for (const c of ["if true; then git commit -m x; fi", "{ git commit -m x; }", "! git commit -m x", "while false; do :; done; until false; do git commit -m x; done"]) {
      expect(plan(c).commits, c).toHaveLength(1);
    }
  });

  it("sees commands behind timeout, sudo, nice, stdbuf, xargs and eval", () => {
    for (const c of ["timeout 60 git commit -m x", "timeout -s KILL 60 git commit -m x", "sudo -u me git commit -m x", "nice -n 5 git commit -m x", "stdbuf -oL git commit -m x", "echo | xargs git commit -m x", 'eval "git commit -m x"']) {
      expect(plan(c).commits, c).toHaveLength(1);
    }
  });

  it("reads a here-string as a word, not a heredoc", () => {
    expect(plan("cat <<< hi\ngit commit -m x").commits).toHaveLength(1);
  });

  it("treats a git add pathspec it cannot know as the whole tree", () => {
    expect(plan("for f in a b; do git add $f; done; git commit -m x").adds).toEqual([{ cwd: "/base", mode: "all", pathspecs: [":/"] }]);
  });

  it("records --pathspec-from-file and git add -f", () => {
    expect(plan("git commit --pathspec-from-file=list.txt -m x").commits[0]?.pathspecFile).toBe("/base/list.txt");
    expect(plan("git add --pathspec-from-file list.txt && git commit -m x").adds[0]?.pathspecFile).toBe("/base/list.txt");
    expect(plan("git add -f ignored.md && git commit -m x").adds[0]?.force).toBe(true);
  });
});

// ---- runHook against temporary git repositories ----

const GOOD_RECORD = `# Root cause
## Symptom
s
## Evidence
e
## Causal chain
c
## Alternatives ruled out
a
## Proposed fix
f
## Verification plan
v
## Review
Status: awaiting review
`;
const NO_REVIEW = GOOD_RECORD.replace(/## Review[\s\S]*$/, "");
const REC = "ai/implementation/root-causes/2026-10-31-S2-scratch.md";

/** A framework-like checkout: the hook script marker and stand-ins for the eslint and tsc binaries. */
function repo({ framework = true, bins = true } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "commit-hook-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "t");
  const put = (p: string, text: string) => {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  };
  put(".gitignore", "node_modules/\n");
  if (framework) put("scripts/claude-commit-hook.mjs", "// marker\n");
  put("ai/implementation/root-causes/2026-10-19-old-record.md", "# old format\n## Cause → symptom chain\nx\n");
  put("packages/framework/src/a.ts", "export const a = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  if (bins) {
    put("node_modules/eslint/bin/eslint.js", "");
    put("node_modules/typescript/bin/tsc", "");
  }
  return dir;
}
const write = (dir: string, p: string, text: string) => {
  mkdirSync(dirname(join(dir, p)), { recursive: true });
  writeFileSync(join(dir, p), text);
};
const stage = (dir: string, ...paths: string[]) => execFileSync("git", ["add", ...paths], { cwd: dir });

type Call = { cmd: string; args: string[]; cwd: string };
/** A runner that records each call and answers with `fail(call)` (a failure's output) or success. */
function recorder(fail: (c: Call) => string | undefined = () => undefined) {
  const calls: Call[] = [];
  const run = (cmd: string, args: string[], cwd: string) => {
    const c = { cmd, args, cwd };
    calls.push(c);
    const out = fail(c);
    return out === undefined ? { status: 0, output: "" } : { status: 1, output: out };
  };
  return { calls, run };
}
const input = (command: string, cwd: string) => ({ tool_name: "Bash", tool_input: { command }, cwd });
const tool = (c: Call) => (c.args.find((a) => a.endsWith("eslint.js")) ? "eslint" : c.args.find((a) => a.endsWith("tsc")) ? "tsc" : c.cmd === "npm" ? "build" : "other");

describe("runHook", () => {
  it("lets non-Bash tools and commands without git commit through without running anything", () => {
    const dir = repo();
    write(dir, REC, NO_REVIEW);
    stage(dir, REC);
    const r = recorder();
    expect(runHook({ tool_name: "Edit", tool_input: { file_path: "x" }, cwd: dir }, { run: r.run }).code).toBe(0);
    expect(runHook(input("git status && git add x", dir), { run: r.run }).code).toBe(0);
    expect(r.calls).toEqual([]);
  });

  it("blocks a commit whose staged root-cause record has no Review section, naming the problem", () => {
    const dir = repo();
    write(dir, REC, NO_REVIEW);
    stage(dir, REC);
    const res = runHook(input("git commit -m scratch", dir), { run: recorder().run });
    expect(res.code).toBe(2);
    expect(res.stderr).toContain(`${REC}: missing section: ## Review`);
  });

  it("lets a commit with a valid staged record through", () => {
    const dir = repo();
    write(dir, REC, GOOD_RECORD);
    stage(dir, REC);
    expect(runHook(input("git commit -m ok", dir), { run: recorder().run })).toEqual({ code: 0, stderr: "" });
  });

  it("does not lint committed records, or records that the commit will not hold", () => {
    const dir = repo();
    write(dir, REC, NO_REVIEW); // untracked, not added by the command
    write(dir, "notes.md", "x");
    stage(dir, "notes.md");
    expect(runHook(input("git commit -m x", dir), { run: recorder().run }).code).toBe(0);
  });

  it("lints a record that the same command adds before committing", () => {
    const dir = repo();
    write(dir, REC, NO_REVIEW);
    expect(runHook(input(`git add ${REC} && git commit -m x`, dir), { run: recorder().run }).code).toBe(2);
    expect(runHook(input("git add -A && git commit -m x", dir), { run: recorder().run }).code).toBe(2);
    expect(runHook(input(`git add ai && git commit -m x`, dir), { run: recorder().run }).code).toBe(2);
    expect(runHook(input(`cd ai && git add . && git commit -m x`, dir), { run: recorder().run }).code).toBe(2);
    expect(runHook(input(`git add notes.md; git commit -m x`, dir), { run: recorder().run }).code).toBe(0);
  });

  it("lints tracked changes for commit -a and commit <pathspec>, from the working tree", () => {
    const dir = repo();
    const old = "ai/implementation/root-causes/2026-10-19-old-record.md";
    write(dir, old, "# still old\n## Cause → symptom chain\ny\n");
    expect(runHook(input("git commit -am x", dir), { run: recorder().run }).code).toBe(2);
    expect(runHook(input(`git commit -m x -- ${old}`, dir), { run: recorder().run }).code).toBe(2);
    expect(runHook(input("git commit -m x", dir), { run: recorder().run }).code).toBe(0); // nothing staged
  });

  it("lints the staged content, not a later working-tree edit", () => {
    const dir = repo();
    write(dir, REC, NO_REVIEW);
    stage(dir, REC);
    write(dir, REC, GOOD_RECORD);
    expect(runHook(input("git commit -m x", dir), { run: recorder().run }).code).toBe(2);
  });

  it("runs eslint on staged JavaScript and TypeScript files and typechecks the projects they belong to", () => {
    const dir = repo();
    write(dir, "packages/framework/test/a.test.ts", "export const a = 2;\n");
    write(dir, "scripts/x.mjs", "export {};\n");
    write(dir, "docs/x.md", "x");
    stage(dir, ".");
    const r = recorder();
    expect(runHook(input("git commit -m x", dir), { run: r.run }).code).toBe(0);
    const eslint = r.calls.filter((c) => tool(c) === "eslint");
    expect(eslint).toHaveLength(1);
    expect(eslint[0]?.cwd).toBe(dir);
    expect(eslint[0]?.args.slice(-2).sort()).toEqual(["packages/framework/test/a.test.ts", "scripts/x.mjs"]);
    expect(eslint[0]?.args).toContain("--no-warn-ignored");
    const tsc = r.calls.filter((c) => tool(c) === "tsc");
    expect(tsc.map((c) => c.args.slice(-2))).toEqual([["-p", "packages/framework/tsconfig.json"]]);
    expect(r.calls.filter((c) => tool(c) === "build")).toEqual([]);
  });

  it("also typechecks the harness project, after a build, when framework source changes (it reads the framework's dist)", () => {
    const dir = repo();
    write(dir, "packages/framework/src/a.ts", "export const a = 2;\n");
    stage(dir, ".");
    const r = recorder();
    expect(runHook(input("git commit -m x", dir), { run: r.run }).code).toBe(0);
    expect(r.calls.filter((c) => tool(c) !== "eslint").map((c) => (tool(c) === "tsc" ? c.args.slice(-1)[0] : tool(c)))).toEqual([
      "packages/framework/tsconfig.json",
      "build",
      "tests/compliance/harness/tsconfig.json",
    ]);
  });

  it("finds the repository when the commit's directory cannot be known, and follows variables, subshells and keywords", () => {
    const dir = repo();
    write(dir, REC, NO_REVIEW);
    stage(dir, REC);
    const elsewhere = mkdtempSync(join(tmpdir(), "commit-hook-elsewhere-"));
    const r = recorder();
    expect(runHook(input('git -C "$(pwd)" commit -m x', dir), { run: r.run }).code).toBe(2);
    expect(runHook(input('cd "$D" && git commit -m x', elsewhere), { run: r.run, env: { D: dir } }).code).toBe(2);
    expect(runHook(input(`(cd ${elsewhere} && ls) && git commit -m x`, dir), { run: r.run }).code).toBe(2);
    expect(runHook(input("if true; then git commit -m x; fi", dir), { run: r.run }).code).toBe(2);
    expect(runHook(input("timeout 60 git commit -m x", dir), { run: r.run }).code).toBe(2);
  });

  it("falls back to the session's repository when the command mentions git and commit but no commit is parsed", () => {
    const dir = repo();
    write(dir, REC, NO_REVIEW);
    stage(dir, REC);
    expect(runHook(input("g=git; $g commit -m x", dir), { run: recorder().run }).code).toBe(2);
    expect(runHook(input("git log --grep=commit", dir), { run: recorder().run }).code).toBe(0);
  });

  it("lints an ignored file that git add -f adds, and the pathspecs of --pathspec-from-file", () => {
    const dir = repo();
    write(dir, ".gitignore", "node_modules/\nai/implementation/root-causes/2026-10-31-S2-ignored.md\n");
    stage(dir, ".gitignore");
    execFileSync("git", ["commit", "-q", "-m", "ignore"], { cwd: dir });
    const ignored = "ai/implementation/root-causes/2026-10-31-S2-ignored.md";
    write(dir, ignored, NO_REVIEW);
    expect(runHook(input(`git add -f ${ignored} && git commit -m x`, dir), { run: recorder().run }).code).toBe(2);
    const old = "ai/implementation/root-causes/2026-10-19-old-record.md";
    write(dir, old, "# still old\n");
    write(dir, "list.txt", `${old}\n`);
    expect(runHook(input("git commit --pathspec-from-file=list.txt -m x", dir), { run: recorder().run }).code).toBe(2);
  });

  it("gives each linter a timeout within the hook's budget, and blocks when the budget runs out", () => {
    const dir = repo();
    write(dir, "packages/framework/src/a.ts", "export const a = 2;\n");
    stage(dir, ".");
    const timeouts: number[] = [];
    const run = (_cmd: string, _args: string[], _cwd: string, timeoutMs: number) => {
      timeouts.push(timeoutMs);
      return { status: 0, output: "" };
    };
    expect(runHook(input("git commit -m x", dir), { run }).code).toBe(0);
    expect(timeouts.length).toBeGreaterThan(0);
    for (const t of timeouts) expect(t > 0 && t <= 280_000).toBe(true);
    const res = runHook(input("git commit -m x", dir), { run, budgetMs: 0 });
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("ran out of time");
  });

  it("maps files to the three typecheck projects, building the framework first for the harness project", () => {
    const dir = repo();
    write(dir, "tests/compliance/criteria/x.test.ts", "export {};\n");
    write(dir, "tests/support/y.ts", "export {};\n");
    write(dir, "vitest.unit.config.ts", "export {};\n");
    stage(dir, ".");
    const r = recorder();
    expect(runHook(input("git commit -m x", dir), { run: r.run }).code).toBe(0);
    expect(r.calls.filter((c) => tool(c) !== "eslint").map((c) => (tool(c) === "tsc" ? c.args.slice(-1)[0] : tool(c)))).toEqual([
      "tsconfig.json",
      "build",
      "tests/compliance/harness/tsconfig.json",
    ]);
    const build = r.calls.find((c) => tool(c) === "build");
    expect(build?.args).toEqual(["run", "build", "-w", "packages/framework"]);
  });

  it("typechecks every project when a tsconfig changes, and none for JavaScript or TypeScript outside them", () => {
    const dir = repo();
    write(dir, "tsconfig.app.json", "{}\n");
    stage(dir, ".");
    const r = recorder();
    runHook(input("git commit -m x", dir), { run: r.run });
    expect(r.calls.filter((c) => tool(c) === "tsc").map((c) => c.args.slice(-1)[0])).toEqual([
      "packages/framework/tsconfig.json",
      "tsconfig.json",
      "tests/compliance/harness/tsconfig.json",
    ]);
    const dir2 = repo();
    write(dir2, "apps/demo/src/x.ts", "export {};\n");
    stage(dir2, ".");
    const r2 = recorder();
    runHook(input("git commit -m x", dir2), { run: r2.run });
    expect(r2.calls.filter((c) => tool(c) === "tsc")).toEqual([]);
    expect(r2.calls.filter((c) => tool(c) === "eslint")).toHaveLength(1);
  });

  it("blocks on an eslint or typecheck failure, with its output, and reports every failing check", () => {
    const dir = repo();
    write(dir, "packages/framework/src/a.ts", "export const a = 2;\n");
    write(dir, REC, NO_REVIEW);
    stage(dir, ".");
    const r = recorder((c) => (tool(c) === "eslint" ? "a.ts: 1:1 error no-unused-vars" : tool(c) === "tsc" ? "a.ts(1,1): error TS2322" : undefined));
    const res = runHook(input("git commit -m x", dir), { run: r.run });
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("no-unused-vars");
    expect(res.stderr).toContain("TS2322");
    expect(res.stderr).toContain("missing section: ## Review");
  });

  it("blocks with a hint when eslint or tsc is not installed", () => {
    const dir = repo({ bins: false });
    write(dir, "packages/framework/src/a.ts", "export const a = 2;\n");
    stage(dir, ".");
    const res = runHook(input("git commit -m x", dir), { run: recorder().run });
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("npm ci");
  });

  it("does nothing outside a framework checkout or outside a git repository", () => {
    const dir = repo({ framework: false });
    write(dir, REC, NO_REVIEW);
    stage(dir, REC);
    expect(runHook(input("git commit -m x", dir), { run: recorder().run }).code).toBe(0);
    const plain = mkdtempSync(join(tmpdir(), "commit-hook-nogit-"));
    expect(runHook(input("git commit -m x", plain), { run: recorder().run }).code).toBe(0);
  });

  it("is not bypassed by --no-verify", () => {
    const dir = repo();
    write(dir, REC, NO_REVIEW);
    stage(dir, REC);
    expect(runHook(input("git commit --no-verify -m x", dir), { run: recorder().run }).code).toBe(2);
  });
});

describe("the hook script and its registration", () => {
  it("reads the hook input on stdin and exits 2 with the problems on stderr", () => {
    const dir = repo();
    write(dir, REC, NO_REVIEW);
    stage(dir, REC);
    const r = spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify(input("git commit -m scratch", dir)), encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("missing section: ## Review");
    expect(spawnSync(process.execPath, [SCRIPT], { input: "not json", encoding: "utf8" }).status).toBe(0);
  });

  it("writes no git hook", () => {
    const dir = repo();
    const before = readdirSync(join(dir, ".git/hooks")).sort();
    write(dir, REC, GOOD_RECORD);
    stage(dir, REC);
    runHook(input("git commit -m x", dir), { run: recorder().run });
    expect(readdirSync(join(dir, ".git/hooks")).sort()).toEqual(before);
    expect(before.every((f) => f.endsWith(".sample"))).toBe(true);
  });

  it("is registered in the repository's .claude/settings.json as a PreToolUse hook on Bash", () => {
    const settings = JSON.parse(readFileSync(join(REPO, ".claude/settings.json"), "utf8")) as {
      hooks: { PreToolUse: { matcher: string; hooks: { type: string; command: string; timeout?: number }[] }[] };
    };
    const entries = settings.hooks.PreToolUse.filter((e) => e.matcher === "Bash");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.hooks).toEqual([expect.objectContaining({ type: "command", command: expect.stringContaining("scripts/claude-commit-hook.mjs") })]);
    expect(entries[0]?.hooks[0]?.timeout).toBeGreaterThanOrEqual(120);
  });

  it("is never shipped to apps: the template's settings have no hooks (TS-18)", () => {
    const template = join(REPO, "apps/template/.claude/settings.json");
    if (existsSync(template)) expect(JSON.parse(readFileSync(template, "utf8"))).not.toHaveProperty("hooks");
    expect(existsSync(join(REPO, "apps/template/scripts/claude-commit-hook.mjs"))).toBe(false);
  });
});
