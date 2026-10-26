/**
 * E2E-002 — One source, both clouds (docs/acceptance/e2e-scenarios.md; Where: Local, cloud), and
 * DEMO-AC-010 "The smoke test passes on local, Cloudflare, and AWS from one commit with no
 * source changes" (docs/demo/demo-spec.md §2; Where: Local, cloud): the local part.
 *
 * Local part: the demo's smoke test (`smoke --target local`) passes against `dev`, run from a copy
 * whose every file is the committed `apps/demo` of this run's commit (no source difference). The
 * copy is a git repository of its own in the OS temp directory (as CLI-AC-005), so `smoke`'s
 * clean-tree check and evidence record happen there and the run's working tree is untouched. The
 * test records the commit and the git tree ID of `apps/demo` as annotations, so the cloud runs
 * can be compared with it.
 *
 * Cloud part: F-03 deploys the demo to a Cloudflare `test-` stage, runs `smoke --target
 * cloudflare` there and confirms no source difference (plan §7 F-03). This test cannot reach a
 * demo stage, so on a cloud target it reports a missing prerequisite (`blocked`), never a pass.
 * The AWS stage is deferred with the AWS target (DEC-0508, branch `aws`); release 1 does not judge it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateEvidence } from "../../../packages/framework/src/evidence/public.js";
import { prerequisiteMissing, tag, target } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { cli, scratchCopy, startDev, type DevSession, type ScratchApp } from "../criteria/core/support/processes.js";
import { setSecret } from "./support/apps.js";
import { DEMO_DIR, randomSecrets } from "./support/demo.js";
import { REPO_ROOT } from "./support/process.js";

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

if (target().target === "local") {
  test(tag(["E2E-002", "DEMO-AC-010"], "local part: the demo's smoke test passes locally against dev, from a copy identical to the commit's apps/demo (no source changes)"), async () => {
    test.setTimeout(25 * 60_000);
    const commit = git(["rev-parse", "HEAD"]).trim();
    const tree = git(["rev-parse", "HEAD:apps/demo"]).trim();
    test.info().annotations.push({ type: "commit", description: commit }, { type: "apps/demo tree", description: tree });

    // No source changes: the working tree's apps/demo is the commit's.
    expect(git(["status", "--porcelain", "--untracked-files=all", "--", "apps/demo"]).trim(), "apps/demo has no uncommitted changes").toBe("");
    const files = git(["ls-files", "-z", "--", "apps/demo"]).split("\0").filter((f) => f !== "");
    expect(files.length, "apps/demo has committed files").toBeGreaterThan(0);

    const copy: ScratchApp = await scratchCopy(DEMO_DIR, "e2e-002", { git: true });
    let dev: DevSession | undefined;
    try {
      // The copy holds exactly the commit's files. `scratchCopy` writes its own `.gitignore` (the
      // scratch repository's ignore list, not app source), so that one file is not compared.
      const differing: string[] = [];
      for (const file of files) {
        const rel = file.slice("apps/demo/".length);
        if (rel === ".gitignore") continue;
        const committed = execFileSync("git", ["show", `HEAD:${file}`], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
        const copied = existsSync(join(copy.dir, rel)) ? readFileSync(join(copy.dir, rel)) : undefined;
        if (copied === undefined || !copied.equals(committed)) differing.push(rel);
      }
      expect(differing, "files of the smoke run that differ from the commit").toEqual([]);

      for (const [name, value] of Object.entries(await randomSecrets())) await setSecret(copy.dir, "local", "local", name, value);
      dev = await startDev(copy.dir);
      const result = await cli(["smoke", "--target", "local", "--stage", "local"], { cwd: copy.dir, timeoutMs: 15 * 60_000 });
      expect(result.status, `smoke --target local --stage local:\n${result.output.slice(-3000)}`).toBe(0);

      const dir = join(copy.dir, "validation", "local");
      const records = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")) : [];
      expect(records.length, "smoke wrote one evidence record").toBe(1);
      const record = JSON.parse(readFileSync(join(dir, records[0] ?? ""), "utf8")) as { results?: { id?: string; status?: string }[]; exitStatus?: number };
      expect(validateEvidence(record), "the smoke record validates against evidence.schema.json").toEqual([]);
      expect(record.exitStatus).toBe(0);
      const results = record.results ?? [];
      expect(results.length, "the smoke test ran tests").toBeGreaterThan(0);
      expect(results.filter((r) => r.status !== "passed"), "smoke results that did not pass").toEqual([]);
    } finally {
      if (dev !== undefined) await dev.stop();
      await copy.remove();
    }
  });
} else {
  test(tag(["E2E-002", "DEMO-AC-010"], "cloud part: the demo's smoke test on a deployed demo test stage, from the same commit"), () => {
    prerequisiteMissing(`cloud part on ${target().target}: F-03 deploys the demo to a test- stage and runs smoke --target ${target().target} there (plan §7 F-03); this run has no demo stage`);
  });
}
