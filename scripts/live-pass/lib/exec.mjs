// How the live-pass runner runs a command, and which environment the framework sees.
//
// The framework reads the variables it always has read: CLOUDFLARE_BOOTSTRAP_TOKEN (the starter
// token), CLOUDFLARE_API_TOKEN (the everyday token) and CLOUDFLARE_ACCOUNT_ID. The runner's own
// variables (LIVE_PASS_*: the admin token and the extra starter tokens) never reach a command.
// A command record holds the arguments, the names of the token variables set, the exit code,
// timing and the scrubbed output; standard input (a generated secret) is never recorded.
import { spawn } from "node:child_process";

/** Variables whose presence (never value) a command record lists. */
const RECORDED_VARS = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_BOOTSTRAP_TOKEN",
  "PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS",
  "NODE_USE_ENV_PROXY",
  "npm_config_yes",
];

/**
 * The environment of a command.
 * @param {Record<string, string | undefined>} base the runner's own environment
 * @param {{ session: 1 | 2, set?: Record<string, string | undefined>, protectIds?: string[] }} options
 */
export function childEnv(base, { session, set = {}, protectIds = [] }) {
  const env = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || k.startsWith("LIVE_PASS_")) continue;
    env[k] = v;
  }
  if (session === 1) delete env.CLOUDFLARE_API_TOKEN;
  if (session === 2) delete env.CLOUDFLARE_BOOTSTRAP_TOKEN;
  if (env.HTTPS_PROXY || env.https_proxy) env.NODE_USE_ENV_PROXY = "1";
  const ids = [...(env.PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS ?? "").split(",").filter(Boolean), ...protectIds.filter(Boolean)];
  if (ids.length > 0) env.PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS = [...new Set(ids)].join(",");
  for (const [k, v] of Object.entries(set)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

/**
 * Runs one command and returns its record.
 * @param {{ argv: string[], cwd: string, env: Record<string,string>, input?: string, timeoutMs?: number,
 *   scrubber: ReturnType<typeof import("./scrub.mjs").createScrubber>, echo?: boolean, label?: string }} options
 */
export function runCommand({ argv, cwd, env, input, timeoutMs = 15 * 60_000, scrubber, echo = true, label }) {
  const startedAt = new Date();
  const recordedEnv = {};
  for (const name of RECORDED_VARS) if (env[name] !== undefined) recordedEnv[name] = "set";
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let error;
    let child;
    const finish = (exitCode, signal) => {
      const endedAt = new Date();
      const raw = `${stdout}\n${stderr}`; // output only: a secret in the output is a finding
      resolve({
        label,
        argv: argv.map((a) => scrubber.text(a)),
        cwd,
        env: recordedEnv,
        stdin: input === undefined ? undefined : "[given, not recorded]",
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - startedAt.getTime(),
        exitCode,
        signal: signal ?? undefined,
        timedOut: timedOut || undefined,
        error: error === undefined ? undefined : scrubber.text(String(error)),
        rawSecretHits: scrubber.rawHits(raw),
        stdout: scrubber.text(stdout),
        stderr: scrubber.text(stderr),
      });
    };
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      error = e;
      finish(null);
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d;
      if (echo) process.stdout.write(scrubber.text(String(d)));
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      if (echo) process.stderr.write(scrubber.text(String(d)));
    });
    child.on("error", (e) => {
      error = e;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      finish(error !== undefined ? null : timedOut && code === 0 ? 124 : code, signal);
    });
    child.stdin.on("error", () => {});
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}
