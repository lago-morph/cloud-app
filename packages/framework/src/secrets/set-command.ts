/**
 * `secrets set <name> --target <t> --stage <s>` (SEC-REQ-004, CLI-REQ-004): the value comes from
 * standard input only. The CLI (B-17) wires these into its command table. No message here
 * repeats a command-line argument, so a value typed by mistake is never printed back.
 */
import type { Target } from "../core/identity.js";
import { FRAMEWORK_SECRETS, isReservedSecretName } from "./names.js";

/** A usage error of `secrets set`; its message never contains an argument. */
export class SecretsSetUsageError extends Error {
  override readonly name = "SecretsSetUsageError";
}

export interface SecretsSetArgs {
  readonly name: string;
  readonly target: Target;
  readonly stage: string;
}

const USAGE = "usage: secrets set <name> --target <local|cloudflare> --stage <stage>; the value is read from standard input";
const TARGETS: readonly Target[] = ["local", "cloudflare"];

/**
 * The value from standard input: every chunk, decoded as UTF-8, with one trailing line ending
 * removed (what `echo` or a terminal adds). Empty input is refused.
 */
export async function readSecretValue(stdin: AsyncIterable<string | Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stdin) text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  text += decoder.decode();
  const value = text.replace(/\r?\n$/, "");
  if (value === "") throw new SecretsSetUsageError(`no value on standard input\n${USAGE}`);
  return value;
}

/** Only a secret the app declares, or a framework-internal secret, can be set. */
export function checkSettableName(name: string, declared: readonly string[]): void {
  const settable = [...declared.filter((n) => !isReservedSecretName(n)), ...Object.values(FRAMEWORK_SECRETS)];
  if (!settable.includes(name)) {
    throw new SecretsSetUsageError(`the secret name is neither declared by the app nor a framework secret; names that can be set: ${settable.join(", ")}`);
  }
}

/** Parses the arguments after `secrets set`. Throws SecretsSetUsageError for anything else. */
export function parseSecretsSetArgs(args: readonly string[]): SecretsSetArgs {
  const fail = (why: string) => new SecretsSetUsageError(`${why}\n${USAGE}`);
  const positionals: string[] = [];
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (key === "value") throw fail("secret values are not accepted as arguments: pipe the value to standard input");
    if (key !== "target" && key !== "stage") throw fail("unknown option (a secret value is never passed as an argument; it is read from standard input)");
    if (options.has(key)) throw fail(`--${key} is given more than once`);
    const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
    if (value === undefined || value === "") throw fail(`--${key} needs a value`);
    options.set(key, value);
  }
  if (positionals.length > 1) {
    throw fail("too many arguments: a secret value is not accepted as an argument; pipe it to standard input");
  }
  const name = positionals[0];
  const target = options.get("target");
  const stage = options.get("stage");
  if (name === undefined) throw fail("the secret name is missing");
  if (target === undefined) throw fail("--target is missing");
  if (stage === undefined) throw fail("--stage is missing");
  if (!TARGETS.includes(target as Target)) throw fail(`--target must be one of: ${TARGETS.join(", ")}`);
  return { name, target: target as Target, stage };
}
