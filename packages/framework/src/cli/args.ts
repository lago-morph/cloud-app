/**
 * Option parsing shared by the commands. Messages never repeat an argument the command did not
 * expect, so a secret value typed by mistake is not printed back (CLI-REQ-004).
 */
import type { Target } from "../core/identity.js";

/** A command-line mistake; the CLI exits with status 2. */
export class UsageError extends Error {
  override readonly name = "UsageError";
}

/** Every supported target, as `--target` accepts it. */
export const TARGETS: readonly Target[] = ["local", "cloudflare", "aws"];

export interface TargetStage {
  readonly target: Target;
  readonly stage: string;
}

/** Parses `--<key> <value>` / `--<key>=<value>` options; every key must be in `allowed`, once. */
export function parseOptions(args: readonly string[], allowed: readonly string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("--")) throw new UsageError("unexpected argument (only options are accepted here)");
    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!allowed.includes(key)) throw new UsageError(`unknown option; accepted: ${allowed.map((k) => `--${k}`).join(", ")}`);
    if (options.has(key)) throw new UsageError(`--${key} is given more than once`);
    const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
    if (value === undefined || value === "" || (eq === -1 && value.startsWith("--"))) throw new UsageError(`--${key} needs a value`);
    options.set(key, value);
  }
  return options;
}

/** `--target <t> --stage <s>`, both required. */
export function parseTargetStage(args: readonly string[]): TargetStage {
  const options = parseOptions(args, ["target", "stage"]);
  const target = options.get("target");
  const stage = options.get("stage");
  if (target === undefined) throw new UsageError("--target is missing");
  if (stage === undefined) throw new UsageError("--stage is missing");
  if (!(TARGETS as readonly string[]).includes(target)) throw new UsageError(`--target must be one of: ${TARGETS.join(", ")}`);
  return { target: target as Target, stage };
}
