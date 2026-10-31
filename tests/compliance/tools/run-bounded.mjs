// `node run-bounded.mjs <timeout-ms> <command> [args…]` (listing.ts): runs the command in its own process
// group and, when it outlives the limit, kills the whole group with SIGKILL. A plain `execFileSync` timeout
// kills only its direct child (here `npx`), and the runner and its workers below it would survive (root cause
// ai/implementation/root-causes/2026-10-31-selection-e2e004-under-load.md, binding fix 1).
// Exit status: the command's own; 124 when the limit was reached; 128 + n when the command died of signal n.
import { spawn } from "node:child_process";
import { constants } from "node:os";

const TIMED_OUT = 124; // listing.ts BOUNDED_TIMED_OUT; as coreutils `timeout`

const [limit, command, ...args] = process.argv.slice(2);
const ms = Number(limit);
if (!Number.isFinite(ms) || ms <= 0 || command === undefined) {
  process.stderr.write("usage: run-bounded.mjs <timeout-ms> <command> [args…]\n");
  process.exit(2);
}

const child = spawn(command, args, { stdio: "inherit", detached: true });
const killGroup = () => {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
  } catch {
    // The group is already gone.
  }
};
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  killGroup();
}, ms);
// Stopped from outside (Ctrl-C, the caller's own kill): the group goes too.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    killGroup();
    process.exit(128 + (constants.signals[signal] ?? 0));
  });
}
child.on("error", (error) => {
  clearTimeout(timer);
  process.stderr.write(`run-bounded: ${error.message}\n`);
  process.exit(127);
});
child.on("exit", (code, signal) => {
  clearTimeout(timer);
  // Anything the command started and left behind in its group goes with it.
  killGroup();
  if (timedOut) {
    process.stderr.write(`run-bounded: ${command} timed out after ${ms} ms; its process group was killed\n`);
    process.exit(TIMED_OUT);
  }
  process.exit(code ?? 128 + (signal === null ? 0 : (constants.signals[signal] ?? 0)));
});
