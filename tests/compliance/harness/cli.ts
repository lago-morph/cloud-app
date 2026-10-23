/**
 * Entry point of `npm run compliance -- …` (launched by `run.mjs`). See `args.ts` for options.
 * Exit status: the test runners' status (0 when every executed test passed), 1 when setting up
 * the target failed, or when cleanup failed (dev did not stop, a stage could not be removed, the
 * leftover check could not run, or the pending-stage list could not be updated) after an otherwise
 * successful run, or when the runner failed unexpectedly (the message is printed), 2 when evidence
 * was refused (working tree differs from the commit), 64 for a usage error.
 */
import { join } from "node:path";
import { parseArgs } from "./args.js";
import { runCompliance } from "./driver.js";
import { nodeDeps } from "./node-deps.js";

// Set by the launcher (launch.mjs); the bundle itself lives under .framework/.
const repoRoot = process.env.COMPLIANCE_REPO_ROOT ?? process.cwd();
const argv = process.argv.slice(2);

const message = (error: unknown): string => `compliance: ${error instanceof Error ? error.message : String(error)}\n`;
let parsed: ReturnType<typeof parseArgs> | undefined;
try {
  parsed = parseArgs(argv);
} catch (error) {
  process.stderr.write(message(error));
}
let exitCode = 64;
if (parsed !== undefined) {
  try {
    // The self-test's record is not compliance evidence: it goes outside validation/ by default.
    const args = parsed.selfTest && parsed.out === undefined ? { ...parsed, out: join(repoRoot, ".framework", "compliance", "self-test") } : parsed;
    exitCode = (await runCompliance(args, argv, nodeDeps(repoRoot))).exitStatus;
  } catch (error) {
    process.stderr.write(message(error));
    exitCode = 1;
  }
}
process.exit(exitCode);
