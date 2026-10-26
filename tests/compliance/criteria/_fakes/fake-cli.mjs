#!/usr/bin/env node
/**
 * A fake framework CLI for the unit tests of the cloud test helpers (root cause
 * ai/implementation/root-causes/2026-10-23-cloud-test-paths.md, "Red tests"). It makes no
 * network call and touches no cloud.
 *
 * - Appends `{ argv, stdin }` as one JSON line to `$FAKE_CLI_LOG`.
 * - Keeps per-stage state in `$FAKE_CLI_STATE/<stage>.json`: `{ worker, secrets }`.
 * - `secrets set <name> … --stage <s>` before any deploy of `s`: exit 1, "… does not exist yet; run deploy first".
 * - `deploy … --stage <s>`: creates the Worker; while a secret in `$FAKE_CLI_SECRETS` (comma
 *   separated, default `apiKey`) is unset, exit 1 "required secrets are not set: <names>";
 *   else prints `https://reference-<s>.example.workers.dev`. A file `fail-next-deploy` in the
 *   state directory makes the next deploy exit 1 with an unrelated message (and is removed).
 * - `remove … --stage <s>`: deletes the stage's state; exit 1 when `fail-remove` exists.
 * - Any command whose `CLOUDFLARE_API_TOKEN` equals `$FAKE_CLI_REFUSED_TOKEN`: exit 1 with the
 *   CLI's Cloudflare API 401 failure (`HTTP 401: Authentication error (code 10000)`).
 */
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const stateDir = process.env.FAKE_CLI_STATE ?? "";
const log = process.env.FAKE_CLI_LOG ?? "";
const required = (process.env.FAKE_CLI_SECRETS ?? "apiKey").split(",").filter((s) => s !== "");

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const stdin = Buffer.concat(chunks).toString("utf8");
  appendFileSync(log, `${JSON.stringify({ argv: args, stdin })}\n`);
  process.exitCode = main(stdin);
});

function option(name) {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
}

function main(stdin) {
  // `$FAKE_CLI_REFUSED_TOKEN`: a call whose CLOUDFLARE_API_TOKEN is this value fails as the CLI does on an API 401.
  const refusedToken = process.env.FAKE_CLI_REFUSED_TOKEN ?? "";
  if (refusedToken !== "" && process.env.CLOUDFLARE_API_TOKEN === refusedToken) {
    process.stderr.write(`${args[0]} failed: listing Worker scripts failed: HTTP 401: Authentication error (code 10000)\n`);
    return 1;
  }
  const stage = option("--stage") ?? "local";
  const file = join(stateDir, `${stage}.json`);
  const state = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { worker: false, secrets: [] };
  const save = () => writeFileSync(file, JSON.stringify(state));
  if (args[0] === "secrets" && args[1] === "set") {
    if (option("--target") !== "local" && !state.worker) {
      process.stderr.write(`Worker reference-${stage} does not exist yet; run deploy first\n`);
      return 1;
    }
    if (stdin === "") {
      process.stderr.write("no value on standard input\n");
      return 1;
    }
    state.secrets = [...new Set([...state.secrets, args[2]])];
    save();
    process.stdout.write(`secret ${args[2]} set\n`);
    return 0;
  }
  if (args[0] === "deploy") {
    state.worker = true;
    save();
    const failMarker = join(stateDir, "fail-next-deploy");
    if (existsSync(failMarker)) {
      rmSync(failMarker);
      process.stderr.write("migration app/0002 failed: UNIQUE constraint failed\n");
      return 1;
    }
    const missing = required.filter((n) => !state.secrets.includes(n));
    if (missing.length > 0) {
      process.stderr.write(`required secrets are not set: ${missing.join(", ")}\n`);
      return 1;
    }
    process.stdout.write(`deployed: https://reference-${stage}.example.workers.dev\n`);
    return 0;
  }
  if (args[0] === "remove") {
    rmSync(file, { force: true });
    if (existsSync(join(stateDir, "fail-remove"))) {
      process.stderr.write("remove failed: fake failure\n");
      return 1;
    }
    process.stdout.write(`removed ${stage}\n`);
    return 0;
  }
  process.stderr.write(`fake cli: unknown command ${args.join(" ")}\n`);
  return 2;
}
