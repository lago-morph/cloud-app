/**
 * CLI-AC-005: `smoke` runs the template's `tests/smoke/**` against the running `dev` server and
 * against a deployed test stage, writes an evidence record, and prints the stage's log location
 * for the day (docs/components/cli.md §4; LOG-REQ-003/-004 give the locations).
 *
 * The template runs from a scratch copy that is a git repository of its own, so `smoke` records
 * its evidence (validation/<target>/<runId>.json, compliance.md) from a clean tree there and the
 * run's own working tree is untouched. Locally the copy runs `dev`; on a cloud it is deployed to a
 * further `test-<random>` stage and removed afterwards (core/support/stages.ts).
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateEvidence } from "../../../../packages/framework/src/evidence/public.js";
import { tag } from "../../harness/index.js";
import { cli, scratchCopy, startDev, type CommandResult, type DevSession } from "../core/support/processes.js";
import { isLocal, runDeployment, TEMPLATE_APP_NAME, TEMPLATE_DIR, uniqueValue, utcDay } from "../core/support/repo.js";
import { withFurtherStage } from "../core/support/stages.js";

async function evidenceRecords(root: string, targetName: string): Promise<{ path: string; record: Record<string, unknown> }[]> {
  const dir = join(root, "validation", targetName);
  if (!existsSync(dir)) return [];
  const out: { path: string; record: Record<string, unknown> }[] = [];
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".json"))) {
    out.push({ path: join(dir, name), record: JSON.parse(await readFile(join(dir, name), "utf8")) as Record<string, unknown> });
  }
  return out;
}

function checkSmoke(result: CommandResult, records: { path: string; record: Record<string, unknown> }[], targetName: string, stage: string, logLocation: string): void {
  expect(result.status, `smoke --target ${targetName} --stage ${stage}:\n${result.output.slice(-3000)}`).toBe(0);
  expect(records.length, "smoke wrote one evidence record").toBe(1);
  const { path, record } = records[0] ?? { path: "", record: {} };
  expect(validateEvidence(record), `${path} validates against evidence.schema.json`).toEqual([]);
  expect(record.target, path).toBe(targetName);
  expect(record.exitStatus, path).toBe(0);
  const results = Array.isArray(record.results) ? (record.results as { status?: string }[]) : [];
  expect(results.filter((r) => r.status !== "passed"), `${path}: smoke results that did not pass`).toEqual([]);
  expect(result.output, "smoke prints the stage's log location for the day").toContain(logLocation);
}

describe("CLI: smoke", () => {
  if (isLocal()) {
    it(
      tag("CLI-AC-005", "locally, smoke runs the template's smoke tests against the running dev server, writes an evidence record and prints today's log file"),
      async () => {
        const copy = await scratchCopy(TEMPLATE_DIR, "cli-ac-005", { git: true });
        let dev: DevSession | undefined;
        try {
          const set = await cli(["secrets", "set", "apiKey", "--target", "local", "--stage", "local"], { cwd: copy.dir, stdin: `${uniqueValue("smokeKey")}\n`, timeoutMs: 120_000 });
          expect(set.status, set.output).toBe(0);
          dev = await startDev(copy.dir);
          const result = await cli(["smoke", "--target", "local", "--stage", "local"], { cwd: copy.dir, timeoutMs: 15 * 60_000 });
          checkSmoke(result, await evidenceRecords(copy.dir, "local"), "local", "local", `.logs/${utcDay(new Date())}.log`);
        } finally {
          if (dev !== undefined) await dev.stop();
          await copy.remove();
        }
      },
      20 * 60_000,
    );
  } else {
    it(
      tag("CLI-AC-005", "on the cloud, smoke runs the template's smoke tests against a deployed test stage, writes an evidence record and prints the stage's log location for the day"),
      async () => {
        const run = runDeployment();
        await withFurtherStage(
          TEMPLATE_DIR,
          TEMPLATE_APP_NAME,
          { apiKey: uniqueValue("smokeKey") },
          async (stage) => {
            const result = await cli(["smoke", "--target", run.target, "--stage", stage.stage], { cwd: stage.copy.dir, timeoutMs: 15 * 60_000, env: { NODE_USE_ENV_PROXY: "1" } });
            const [y, m, d] = utcDay(new Date()).split("-");
            checkSmoke(result, await evidenceRecords(stage.copy.dir, run.target), run.target, stage.stage, `${TEMPLATE_APP_NAME}/${stage.stage}/${y ?? ""}/${m ?? ""}/${d ?? ""}/`);
          },
          { git: true },
        );
      },
      60 * 60_000,
    );
  }
});
