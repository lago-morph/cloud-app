/**
 * CLI-AC-008 (docs/components/cli.md §4, CLI-REQ-006; Where: Local): "In a git repository
 * holding `.env.cloudflare`: with the file not ignored, and again with it tracked (and listed in
 * `.gitignore`), `deploy --target cloudflare` (against the fake Cloudflare API) and `verify` each
 * print the matching warning, set off by rule lines, on every run; the tracked warning names
 * `git rm --cached .env.cloudflare`. Each exit status equals that of the same run with the file
 * ignored and untracked. Outside a git repository, and when the git check itself fails, they
 * print no git warning and their exit status is unchanged."
 *
 * - `deploy`: the CLI's own Cloudflare binding path in process (`withCloudflareSettings`, which
 *   reads `.env.cloudflare` and prints its warnings, around `deployCommand` and the PROV core),
 *   with the framework's Cloudflare target on the in-memory account (`FakeCloud`). Both a deploy
 *   that succeeds (exit 0) and one that stops at step 1 (no signing record, exit 1) are run under
 *   every condition, twice each ("on every run"). "The git check itself fails": `git` cannot be
 *   started (no PATH entry holds it).
 * - `verify`: the package binary on a scratch copy of apps/template (the real binding, its real
 *   steps), for the not-ignored, tracked, clean and no-repository conditions; and `verifyCommand`
 *   in process with stand-in steps for a failing verify and for a git check that throws.
 *
 * "Set off by rule lines": a line of one mark repeated 10 times or more above and below the
 * warning's paragraph (the reading the SETUP criteria use too). Fake token values only.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { withCloudflareSettings } from "../../../../packages/framework/src/cli/cloudflare-settings.js";
import { deployCommand } from "../../../../packages/framework/src/cli/commands/deploy.js";
import { verifyCommand, type VerifyDeps } from "../../../../packages/framework/src/cli/commands/verify.js";
import { captureIo } from "../../../../packages/framework/src/cli/io.test-support.js";
import type { Migration } from "../../../../packages/framework/src/mig/history.js";
import { commandGitSafetyWarnings, inspectGitSafety } from "../../../../packages/framework/src/provision/cloudflare/git-safety.js";
import type { HealthOutcome } from "../../../../packages/framework/src/provision/core/operations.js";
import { ACCOUNT, FakeCloud, FakeDatabases } from "../../../../packages/framework/src/provision/cloudflare/fake-cloud.test-support.js";
import { createCloudflareTarget } from "../../../../packages/framework/src/provision/cloudflare/target.js";
import { cli, scratchCopy, type CommandResult, type ScratchApp } from "../core/support/processes.js";
import { isLocal, TEMPLATE_DIR } from "../core/support/repo.js";
import { git, setOffByRules, tokenValue } from "../setup/support/setup-runs.js";

type Condition = "clean" | "not ignored" | "tracked" | "no repository" | "git fails";
const CONDITIONS: readonly Condition[] = ["clean", "not ignored", "tracked", "no repository", "git fails"];

const NOT_IGNORED = /\.env\.cloudflare[^\n]*(not ignore|does not ignore|isn't ignored|not git-ignored)|(not ignore|does not ignore)[^\n]*\.env\.cloudflare/i;
const TRACKED = /\.env\.cloudflare[^\n]*tracked|tracked[^\n]*\.env\.cloudflare/i;
const ANY_GIT_WARNING = /WARNING[^\n]*(\.env\.cloudflare|git)|\.env\.cloudflare[^\n]*(tracked|not ignore|does not ignore)/i;

const dirs: string[] = [];

/** A folder holding `.env.cloudflare` (a fake everyday token) in the git state `condition` names. */
function folder(condition: Condition): string {
  const dir = mkdtempSync(join(tmpdir(), "cli-ac-008-"));
  dirs.push(dir);
  writeFileSync(join(dir, ".env.cloudflare"), `CLOUDFLARE_API_TOKEN=${tokenValue("cli008")}\nCLOUDFLARE_ACCOUNT_ID=${ACCOUNT}\n`);
  if (condition === "no repository") return dir;
  git(dir, ["init", "-q"]);
  writeFileSync(join(dir, ".gitignore"), condition === "not ignored" || condition === "git fails" ? "node_modules\n" : "node_modules\n.env.cloudflare\n");
  if (condition === "tracked") {
    git(dir, ["add", "-f", ".gitignore", ".env.cloudflare"]);
    git(dir, ["commit", "-q", "-m", "tracked by mistake"]);
  }
  return dir;
}

/** Runs `fn` with no `git` reachable on PATH (the git check cannot run). */
async function withoutGit<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env.PATH;
  process.env.PATH = join(tmpdir(), "cli-ac-008-no-git-here");
  try {
    return await fn();
  } finally {
    process.env.PATH = saved;
  }
}

const migration = (id: string): Migration => ({ id, name: id.split("/")[1] ?? id, file: `${id}.sql`, text: "", checksum: "", statements: [] });

/** `deploy --target cloudflare --stage test-cliac008` in `dir` on a fresh fake account; `stops` removes the signing record so step 1 stops. */
async function deploy(dir: string, stops: boolean): Promise<{ status: number; err: string; out: string }> {
  const cloud = FakeCloud.withSharedResources();
  if (stops) {
    cloud.objectBodies.delete("sst-state/framework/r2-signing.json");
    cloud.buckets.get("sst-state")?.delete("framework/r2-signing.json");
  }
  const command = withCloudflareSettings(
    "deploy",
    async (env) =>
      deployCommand({
        env,
        prepare: async () => ({ app: "reference", migrations: { framework: [migration("framework/0001_init")], app: [migration("app/0001_schema")] }, requiredSecrets: [], code: undefined }),
        operations: ({ appDir }) =>
          createCloudflareTarget({
            api: cloud.api,
            accountId: ACCOUNT,
            env,
            appDir,
            databases: new FakeDatabases(),
            sst: cloud.sst,
            fetch: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
            code: { bundle: "/app/.framework/cloudflare/worker.js", compatibilityDate: "2026-10-01", logBucketBinding: "LOGS" },
            files: {
              bucketCors: (origin) => ({ rules: [{ allowed: { origins: [origin], methods: ["PUT", "GET"], headers: ["Content-Type"] }, maxAgeSeconds: 60 }] }),
              storagePreflight: async (): Promise<HealthOutcome> => ({ ok: true }),
            },
            randomKey: () => "generated-session-key",
            sleep: async () => {},
          }),
        recordDeployOutput: () => undefined,
      }),
    // The process environment: no Cloudflare setting (the file supplies the token), no proxy.
    { CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
  );
  const io = captureIo(dir);
  const status = await command(["--target", "cloudflare", "--stage", "test-cliac008"], io);
  return { status, err: io.err, out: io.out };
}

/** The checks of one condition's two runs against the clean runs' status. */
function expectWarnings(condition: Condition, runs: readonly { status: number; err: string; out: string }[], cleanStatus: number): void {
  for (const [i, r] of runs.entries()) {
    const text = r.out + r.err;
    expect(r.status, `${condition}, run ${String(i + 1)}: exit status equals the clean run's\n${text}`).toBe(cleanStatus);
    if (condition === "not ignored") {
      expect(setOffByRules(text, NOT_IGNORED), `run ${String(i + 1)}: the not-ignored warning, set off by rule lines:\n${text}`).toBe(true);
    } else if (condition === "tracked") {
      expect(setOffByRules(text, TRACKED), `run ${String(i + 1)}: the tracked warning, set off by rule lines:\n${text}`).toBe(true);
      expect(text).toContain("git rm --cached .env.cloudflare");
    } else {
      expect(ANY_GIT_WARNING.test(text), `${condition}, run ${String(i + 1)}: no git warning:\n${text}`).toBe(false);
    }
  }
}

if (isLocal()) {
  afterAll(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  describe("CLI-AC-008: deploy --target cloudflare (fake Cloudflare API)", () => {
    for (const stops of [false, true]) {
      const outcome = stops ? "a deploy that stops at step 1" : "a deploy that succeeds";
      it(tag("CLI-AC-008", `${outcome}: the not-ignored and tracked warnings set off by rule lines on every run, none outside a repository or when git cannot run; every exit status equals the clean run's`), async () => {
        const clean = folder("clean");
        const cleanRuns = [await deploy(clean, stops), await deploy(clean, stops)];
        const cleanStatus = cleanRuns[0]?.status ?? -1;
        expect(cleanStatus, `the clean run's status:\n${cleanRuns[0]?.err ?? ""}`).toBe(stops ? 1 : 0);
        expectWarnings("clean", cleanRuns, cleanStatus);
        for (const condition of CONDITIONS.filter((c) => c !== "clean")) {
          const dir = folder(condition);
          const runs = condition === "git fails" ? await withoutGit(async () => [await deploy(dir, stops), await deploy(dir, stops)]) : [await deploy(dir, stops), await deploy(dir, stops)];
          expectWarnings(condition, runs, cleanStatus);
        }
      });
    }
  });

  describe("CLI-AC-008: verify", () => {
    const passing: Omit<VerifyDeps, "gitSafetyWarnings"> = {
      typeCheck: async () => [],
      portabilityRules: async () => [],
      migrationChecker: async () => [],
      zodVersion: async () => ({ expected: "4.6.7", installed: "4.6.7" }),
      runTests: async () => ({ tests: [{ file: "tests/a.test.ts", name: "a", state: "passed", errors: [] }], fileErrors: [] }),
    };
    const failing: Omit<VerifyDeps, "gitSafetyWarnings"> = { ...passing, typeCheck: async () => [{ file: "src/a.ts", line: 1, column: 1, rule: "TS2322", message: "a type error" }] };
    // The git check as the CLI wires it (wiring.ts `verifyBinding`): the file's warnings in a repository.
    const wired = (appDir: string): readonly string[] => commandGitSafetyWarnings(inspectGitSafety(appDir));

    async function verifyIn(dir: string, steps: Omit<VerifyDeps, "gitSafetyWarnings">, gitCheck: VerifyDeps["gitSafetyWarnings"] = wired) {
      const io = captureIo(dir);
      const status = await verifyCommand({ ...steps, gitSafetyWarnings: gitCheck })([], io);
      return { status, out: io.out, err: io.err };
    }

    it(tag("CLI-AC-008", "a failing verify (in process, stand-in steps, the wired git check): the warnings on every run, none outside a repository or when the git check fails, and the exit status always the clean run's"), async () => {
      const clean = folder("clean");
      const cleanRuns = [await verifyIn(clean, failing), await verifyIn(clean, failing)];
      expect(cleanRuns[0]?.status).toBe(1);
      expectWarnings("clean", cleanRuns, 1);
      for (const condition of CONDITIONS.filter((c) => c !== "clean")) {
        const dir = folder(condition);
        const runs = condition === "git fails" ? await withoutGit(async () => [await verifyIn(dir, failing), await verifyIn(dir, failing)]) : [await verifyIn(dir, failing), await verifyIn(dir, failing)];
        expectWarnings(condition, runs, 1);
      }
    });

    it(tag("CLI-AC-008", "a git check that throws does not fail verify: no warning, exit status 0 as with no condition"), async () => {
      const dir = folder("not ignored");
      const r = await verifyIn(dir, passing, () => {
        throw new Error("git check failed");
      });
      expect(r.status, r.out).toBe(0);
      expect(ANY_GIT_WARNING.test(r.out + r.err)).toBe(false);
    });

    describe("the package binary on a copy of apps/template", () => {
      let repo: ScratchApp | undefined;
      let bare: ScratchApp | undefined;
      const results = new Map<Condition, CommandResult[]>();

      afterAll(async () => {
        await repo?.remove();
        await bare?.remove();
      }, 120_000);

      it(tag("CLI-AC-008", "verify on the template: not ignored, tracked (and listed in .gitignore), clean and outside a repository; the warnings set off by rule lines, the tracked one naming git rm --cached .env.cloudflare, and every exit status the clean run's"), async () => {
        repo = await scratchCopy(TEMPLATE_DIR, "cli-ac-008", { git: true });
        bare = await scratchCopy(TEMPLATE_DIR, "cli-ac-008-bare");
        const verify = (dir: string) => cli(["verify"], { cwd: dir, timeoutMs: 10 * 60_000 });
        await repo.write(".env.cloudflare", `CLOUDFLARE_API_TOKEN=${tokenValue("cli008v")}\n`);
        results.set("not ignored", [await verify(repo.dir)]);
        await repo.write(".gitignore", `${await repo.read(".gitignore")}.env.cloudflare\n`);
        results.set("clean", [await verify(repo.dir)]);
        git(repo.dir, ["add", "-f", ".gitignore", ".env.cloudflare"]);
        git(repo.dir, ["commit", "-q", "-m", "tracked by mistake"]);
        results.set("tracked", [await verify(repo.dir)]);
        await bare.write(".env.cloudflare", `CLOUDFLARE_API_TOKEN=${tokenValue("cli008b")}\n`);
        results.set("no repository", [await verify(bare.dir)]);
        const clean = results.get("clean")?.[0];
        expect(clean?.status, `verify passes on the template:\n${clean?.output.slice(-2000) ?? ""}`).toBe(0);
        for (const [condition, runs] of results) {
          expectWarnings(
            condition,
            runs.map((r) => ({ status: r.status ?? -1, out: r.output, err: "" })),
            clean?.status ?? 0,
          );
        }
        // "Before its first step and again before its verdict" (cli.md §2): the not-ignored warning twice in one run.
        const notIgnored = results.get("not ignored")?.[0]?.output ?? "";
        expect(notIgnored.split("\n").filter((l) => NOT_IGNORED.test(l)).length, notIgnored.slice(0, 3000)).toBeGreaterThanOrEqual(2);
      }, 45 * 60_000);
    });
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on cloud runs.
  describe("CLI-AC-008 (local only)", () => {
    it("has nothing to run on a cloud", () => undefined);
  });
}
