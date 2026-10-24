/**
 * `npm run compliance -- --target <local|cloudflare> [--stage <s>] [--milestone]
 *   [--base-url <url>] [--only <ID,…>] [--blocked <ID,…|*>=<reason>]… [--out <dir>] [--self-test]`
 */
import { DEFERRED, type ReleaseTarget } from "./catalogue.js";

export interface ComplianceArgs {
  /** Release 1's targets only (DEC-0508). */
  readonly target: ReleaseTarget;
  /** Cloud only: an existing or chosen test stage (`test-…`); default `test-<runId>`. */
  readonly stage?: string;
  readonly milestone: boolean;
  /** Use an already running app (local `dev` or a deployed stage) instead of starting/deploying one. */
  readonly baseUrl?: string;
  /** Run only these IDs; every other expected ID is recorded `not-run`. */
  readonly only?: readonly string[];
  /** IDs whose prerequisite is missing, with the reason; their tests are not run. Key `*`: every ID. */
  readonly blocked: ReadonlyMap<string, string>;
  /** Directory that receives `validation/`; default the repository root. */
  readonly out?: string;
  readonly selfTest: boolean;
}

const ID = /^(?:[A-Z]+-AC|E2E)-\d{3}$/;
/** `--blocked '*=<reason>'`: every criterion the run would execute is blocked (for example the cloud's database is unavailable). */
export const ALL = "*";

function ids(text: string, option: string): string[] {
  const list = text.split(",").map((s) => s.trim()).filter((s) => s !== "");
  for (const id of list) if (!ID.test(id)) throw new Error(`${option}: ${JSON.stringify(id)} is not a criterion or scenario ID`);
  return list;
}

export function parseArgs(argv: readonly string[]): ComplianceArgs {
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  const withValue = new Set(["--target", "--stage", "--base-url", "--only", "--blocked", "--out"]);
  const bare = new Set(["--milestone", "--self-test"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    const eq = arg.indexOf("=");
    const name = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
    if (bare.has(name)) {
      flags.add(name);
      continue;
    }
    if (!withValue.has(name)) throw new Error(`unknown option ${arg}`);
    const value = name !== arg ? arg.slice(eq + 1) : argv[(i += 1)];
    if (value === undefined) throw new Error(`${name} needs a value`);
    values.set(name, [...(values.get(name) ?? []), value]);
  }
  const one = (name: string): string | undefined => values.get(name)?.at(-1);
  const selfTest = flags.has("--self-test");
  const target = one("--target") ?? (selfTest ? "local" : undefined);
  if (target === undefined) throw new Error("--target <local|cloudflare> is required");
  if (target === "aws") throw new Error(`--target aws: the AWS target is ${DEFERRED}; use local or cloudflare`);
  if (target !== "local" && target !== "cloudflare") throw new Error(`--target ${target}: use local or cloudflare`);
  const stage = one("--stage");
  if (stage !== undefined && target === "local") throw new Error("--stage applies to cloud targets only");
  if (stage !== undefined && !stage.startsWith("test-")) throw new Error(`--stage ${stage}: compliance runs use test stages only (names starting with test-)`);

  const blocked = new Map<string, string>();
  for (const spec of values.get("--blocked") ?? []) {
    const eq = spec.indexOf("=");
    if (eq <= 0 || spec.slice(eq + 1).trim() === "") throw new Error(`--blocked ${spec}: use --blocked <ID>[,<ID>…]=<reason>`);
    const which = spec.slice(0, eq).trim();
    for (const id of which === ALL ? [ALL] : ids(which, "--blocked")) blocked.set(id, spec.slice(eq + 1).trim());
  }
  const only = one("--only");
  const baseUrl = one("--base-url");
  const out = one("--out");
  return {
    target,
    ...(stage === undefined ? {} : { stage }),
    milestone: flags.has("--milestone"),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(only === undefined ? {} : { only: ids(only, "--only") }),
    ...(out === undefined ? {} : { out }),
    blocked,
    selfTest,
  };
}
