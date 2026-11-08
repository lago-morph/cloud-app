// How the live-pass runner runs a command, and which environment the framework sees.
//
// The framework reads the variables it always has read: CLOUDFLARE_BOOTSTRAP_TOKEN (the starter
// token), CLOUDFLARE_API_TOKEN (the everyday token) and CLOUDFLARE_ACCOUNT_ID. Each token reaches
// only the command a step sets it for (DEC-0793): the runner keeps them in its secrets directory,
// never in its own environment. No CLOUDFLARE_* or LIVE_PASS_* variable of the runner's own
// environment reaches a command: in a cloud sandbox those can belong to the primary Cloudflare
// account. A command record holds the arguments, the names of the token variables set, the exit
// code, timing and the scrubbed output; standard input (a generated secret) is never recorded.
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
 * The environment of a command: the runner's environment without any CLOUDFLARE_* or LIVE_PASS_*
 * variable, the test Cloudflare account's ID, and what the step sets for this command.
 * @param {Record<string, string | undefined>} base the runner's own environment
 * @param {{ accountId?: string, set?: Record<string, string | undefined>, protectIds?: string[] }} options
 */
export function childEnv(base, { accountId, set = {}, protectIds = [] }) {
  if (typeof accountId !== "string" || accountId === "") throw new Error("childEnv needs the test Cloudflare account's ID");
  const env = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || k.startsWith("LIVE_PASS_") || k.startsWith("CLOUDFLARE_")) continue;
    env[k] = v;
  }
  env.CLOUDFLARE_ACCOUNT_ID = accountId;
  if (env.HTTPS_PROXY || env.https_proxy) env.NODE_USE_ENV_PROXY = "1";
  const ids = [...(env.PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS ?? "").split(",").filter(Boolean), ...protectIds.filter(Boolean)];
  if (ids.length > 0) env.PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS = [...new Set(ids)].join(",");
  for (const [k, v] of Object.entries(set)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

/** Buffers text until a line ends (`\n` or `\r`), then writes the complete lines; `end` writes the rest. */
function lineEcho(write) {
  let rest = "";
  return {
    push(chunk) {
      rest += chunk;
      const cut = Math.max(rest.lastIndexOf("\n"), rest.lastIndexOf("\r"));
      if (cut < 0) return;
      write(rest.slice(0, cut + 1));
      rest = rest.slice(cut + 1);
    },
    end() {
      if (rest !== "") write(rest);
      rest = "";
    },
  };
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
    // The echo is scrubbed line by line: a value split across two pipe chunks is whole once its line ends.
    const outEcho = lineEcho((t) => process.stdout.write(scrubber.text(t)));
    const errEcho = lineEcho((t) => process.stderr.write(scrubber.text(t)));
    child.stdout.on("data", (d) => {
      stdout += d;
      if (echo) outEcho.push(String(d));
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      if (echo) errEcho.push(String(d));
    });
    child.on("error", (e) => {
      error = e;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (echo) {
        outEcho.end();
        errEcho.end();
      }
      finish(error !== undefined ? null : timedOut && code === 0 ? 124 : code, signal);
    });
    child.stdin.on("error", () => {});
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}
