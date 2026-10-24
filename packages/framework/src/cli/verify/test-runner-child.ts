/**
 * Child process of `verify`'s test step (`tests.ts`): `node test-runner-child.js <appDir> <summary.json>`
 * with `PROTOTYPE_FRAMEWORK_DIALECT` set. Runs the app's tests once with Vitest's Node API and
 * writes the summary; exits 0 when the summary was written (the parent judges the results).
 */
import { writeFileSync } from "node:fs";
import { startVitest } from "vitest/node";
import { summarizeFiles, testRunnerOptions } from "./tests.js";

const [appDir, out] = process.argv.slice(2);
if (appDir === undefined || out === undefined) {
  process.stderr.write("usage: test-runner-child <appDir> <summary.json>\n");
  process.exit(2);
}
const vitest = await startVitest([], testRunnerOptions(appDir) as never);
const files = vitest.state.getFiles();
const unhandled = vitest.state.getUnhandledErrors().map((e) => ({ file: "(test run)", message: e instanceof Error ? e.message : String(e) }));
const summary = summarizeFiles(appDir, files as never);
writeFileSync(out, JSON.stringify({ tests: summary.tests, fileErrors: [...summary.fileErrors, ...unhandled] }));
await vitest.close();
process.exit(0);
