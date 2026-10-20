/**
 * The cloud path of the CLI's process (D-05): every command that talks to a cloud from Node
 * (`deploy`, `remove`, `setup-account`, `secrets set` and `smoke` on a cloud target) needs its
 * `fetch` to reach the cloud. Behind an HTTPS proxy, Node's `fetch` uses the proxy only when the
 * process was started with `NODE_USE_ENV_PROXY=1` (DEC-0085, DEC-0107); the variable cannot be
 * set from inside the running process. So the command checks it first and stops, naming the
 * variable, before any request is sent. On a machine without a proxy nothing is required.
 *
 * `smoke --target <cloud>` is C-04's command; its stage form reads the base URL that `deploy`
 * records (`recordDeployOutput`, DEC-0272). This module only adds the process check in front.
 */
import { EXIT, type Command } from "../io.js";

export type ProcessEnvironment = Readonly<Record<string, string | undefined>>;

const PROXY_VARIABLES = ["HTTPS_PROXY", "https_proxy"] as const;

/** What stops this process from reaching a cloud with `fetch`; empty when nothing does. */
export function cloudProcessProblems(env: ProcessEnvironment): string[] {
  const proxied = PROXY_VARIABLES.some((name) => (env[name] ?? "") !== "");
  if (!proxied || env.NODE_USE_ENV_PROXY === "1") return [];
  return ["HTTPS_PROXY is set, but this process was not started with NODE_USE_ENV_PROXY=1, so Node's fetch would bypass the proxy: run the command again with NODE_USE_ENV_PROXY=1 in its environment"];
}

/** The value of `--target` in `args`, if given. */
export function targetArgument(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--target") return args[i + 1];
    if (arg.startsWith("--target=")) return arg.slice("--target=".length);
  }
  return undefined;
}

/** `command` (smoke), checking the process environment first when it targets a cloud. */
export function withCloudProcessCheck(command: Command, env: ProcessEnvironment = process.env): Command {
  return async (args, io) => {
    const target = targetArgument(args);
    if (target !== undefined && target !== "local") {
      const problems = cloudProcessProblems(env);
      if (problems.length > 0) {
        io.stderr(`smoke: ${problems.join("; ")}\n`);
        return EXIT.failed;
      }
    }
    return command(args, io);
  };
}
