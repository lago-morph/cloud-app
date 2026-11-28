/**
 * Shared support for the SETUP criteria (docs/components/setup.md §4, SETUP-AC-001…010, rewritten
 * for the one credential, DEC-0795…DEC-0800): projects and home directories in temporary folders,
 * runs of `cloudflare-setup` against the fake Cloudflare API, and the record of every run's output
 * that SETUP-AC-010 searches.
 *
 * Written from setup.md and cli.md, not from the command's code. The command is the framework CLI's
 * own `cloudflare-setup` (`cloudflareSetupCommand`: its argument check, the credential's sources,
 * the local setup and the git checks are the real ones); only the Cloudflare API (`SetupWorld` on
 * `FakeCloud`, the in-memory account the framework's tests use, shapes recorded from the live API),
 * the home directory (a temporary one, so the operator's `~/.secrets/cloudflare` is never read), the
 * network check's reach, the auth app's source and the local setup's `npm install` and secret names
 * are injected. No network.
 *
 * Every fake sensitive value carries the run's marker (plan-setup-wizard §6: "a fake token with a
 * marker string, searched for in every output"): token values, token IDs, the second account's ID,
 * the workers.dev subdomains. The fake's own account ID and zone IDs are registered too.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { cloudflareSetupCommand, type CloudflareSetupCommandDeps } from "../../../../../packages/framework/src/cli/commands/cloudflare-setup.js";
import type { ApiReply, CloudflareApi } from "../../../../../packages/framework/src/provision/cloudflare/api.js";
import { ACCOUNT, FakeCloud } from "../../../../../packages/framework/src/provision/cloudflare/fake-cloud.test-support.js";
import { ACCOUNT_SETUP_VERSION, deepLink, EVERYDAY, TOKEN, type PermissionGroup, type TokenPolicy } from "../../../../../packages/framework/src/provision/cloudflare/permissions.js";
import { applySetupSteps, SETUP_STEPS } from "../../../../../packages/framework/src/provision/cloudflare/setup-steps.js";
import { SetupWorld, type WorldToken } from "../../../../../packages/framework/src/provision/cloudflare/setup-world.test-support.js";
import { runLocalSetup } from "../../../../../packages/framework/src/provision/core/local-setup.js";

export { ACCOUNT, FakeCloud, SetupWorld, type WorldToken, type ApiReply, type CloudflareApi, type TokenPolicy, type PermissionGroup };

/** This run's marker, in every fake sensitive value. */
export const MARK = `setupac${randomBytes(4).toString("hex")}`;

/** The second account (the account-switch and several-accounts criteria): its ID carries the marker. */
export const SECOND_ACCOUNT = `${MARK}${randomBytes(9).toString("hex")}`.slice(0, 32);

/** The credential's settings (setup.md SETUP-REQ-002, DEC-0795). */
export const TOKEN_SETTING = "CLOUDFLARE_API_TOKEN";
export const ACCOUNT_SETTING = "CLOUDFLARE_ACCOUNT_ID";

/** PAR-343: the `.gitignore` marker that keeps setup from adding `.env.cloudflare`. */
export const KEEP_TRACKED_MARKER = "# keep-env-cloudflare-tracked";

/** PAR-361: the setting naming token IDs setup never updates or deletes. */
export const PROTECTED_IDS_SETTING = "PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS";

/** The template, exactly its two lines with nothing after the = (SETUP-REQ-003, owner decision 2). */
export const TEMPLATE_LINES = ["CLOUDFLARE_API_TOKEN=", "CLOUDFLARE_ACCOUNT_ID="] as const;

/** The next prompt (plan §3.2, SETUP-REQ-003). */
export const NEXT_PROMPT_PHRASE = "continue prototype setup";

/** The one token's link (DEC-0797) and the admin app's everyday token's, which setup never prints. */
export const TOKEN_LINK = deepLink("token");
export const EVERYDAY_LINK = deepLink("everyday");

/** The one token's list, by name (PAR-331 version 3). */
export const TOKEN_NAMES_LIST = ["Workers Scripts Write", "Workers R2 Storage Write", "D1 Write", "Secrets Store Write", "OAuth Client Write", "Account API Tokens Write"];

/** The permission group of either list with this name. */
export function group(name: string): PermissionGroup {
  const g = [...EVERYDAY, ...TOKEN].find((x) => x.name === name);
  if (g === undefined) throw new Error(`no permission group named ${name}`);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Sensitive values and the run record (SETUP-AC-010)
// ---------------------------------------------------------------------------------------------

const sensitive = new Map<string, string>([
  [ACCOUNT, "the fake account's ID"],
  [SECOND_ACCOUNT, "the second account's ID"],
]);

function register(value: string, label: string): string {
  sensitive.set(value, label);
  return value;
}

/** A fake token value with the marker. */
export const tokenValue = (label: string): string => register(`${MARK}-${label}-token-${randomBytes(12).toString("hex")}`, `token value ${label}`);
/** A fake token ID with the marker. */
export const tokenId = (label: string): string => register(`${MARK}id${label}${randomBytes(6).toString("hex")}`, `token ID ${label}`);
/** A fake workers.dev subdomain with the marker. */
export const subdomain = (label: string): string => register(`${MARK}${label}`, `workers.dev subdomain ${label}`);

/** The primary account's subdomain, registered by setup's `subdomain` step. */
export const SUB = subdomain("sub");

export interface RecordedRun {
  readonly label: string;
  readonly out: string;
  readonly err: string;
  /** Files the run left in the project (other than `.git/` and an old `.env.cloudflare` the test wrote) and in the home directory (other than the secrets file the test wrote), with their text. */
  readonly files: Readonly<Record<string, string>>;
}

/** Every run of every test in this process, in order. */
export const RUNS: RecordedRun[] = [];

/** Zone IDs of every account the world holds (registered when searched). */
function zoneIds(world: SetupWorld): string[] {
  return [...world.accounts.values()].flatMap((a) => [...a.cloud.zones.values()].map((z) => z.id));
}
const worlds = new Set<SetupWorld>();

/** Every sensitive value known to this process: label → value. */
export function sensitiveValues(): Map<string, string> {
  const all = new Map(sensitive);
  for (const w of worlds) for (const id of zoneIds(w)) all.set(id, "a zone ID");
  // The OAuth client secrets their creates showed once (v0.2.0 plan §5.1 step 2), and the signing token values the fake made.
  for (const w of worlds) for (const a of w.accounts.values()) for (const c of a.cloud.oauthClients.values()) all.set(c.secret, "an OAuth client secret");
  // The fake answers a token create with the value `value-of-<id>` (the signing token setup mints).
  for (const w of worlds) for (const a of w.accounts.values()) for (const id of a.cloud.tokens.keys()) all.set(`value-of-${id}`, "a signing token value");
  return all;
}

/** The (run label, value label) pairs where a recorded output holds a sensitive value. */
export function sensitiveHits(runs: readonly RecordedRun[] = RUNS): string[] {
  const values = sensitiveValues();
  const hits: string[] = [];
  for (const r of runs) {
    // The summary prints the admin app's URL, which holds the subdomain (DEC-0686): that URL alone is allowed, on standard output.
    const out = [...values].filter(([, label]) => label.startsWith("workers.dev subdomain")).reduce((text, [sub]) => text.split(`https://prototype-admin.${sub}.workers.dev`).join("<admin app URL>"), r.out);
    const texts: [string, string][] = [["stdout", out], ["stderr", r.err], ...Object.entries(r.files).map(([p, t]): [string, string] => [`file ${p}`, t])];
    for (const [where, text] of texts) {
      // A zone ID such as `zone1` is matched as a whole word only.
      for (const [value, label] of values) {
        const found = label === "a zone ID" ? new RegExp(`\\b${value}\\b`).test(text) : text.includes(value);
        if (found) hits.push(`${r.label}: ${where} holds ${label}`);
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------
// Worlds, tokens and projects
// ---------------------------------------------------------------------------------------------

/** A world whose main account ("Main account", the fake's ID) has had no setup yet. */
export function freshWorld(): SetupWorld {
  const world = new SetupWorld();
  world.cloud().subdomain = undefined;
  worlds.add(world);
  return world;
}

/** Adds the second account ("Second account"), not set up, with its own subdomain. */
export function addSecondAccount(world: SetupWorld): FakeCloud {
  const cloud = new FakeCloud();
  cloud.subdomain = undefined;
  world.addAccount(SECOND_ACCOUNT, "Second account", cloud);
  return cloud;
}

/** The user's one token on `account`, made from the deep link (every group of `TOKEN`). */
export function addToken(world: SetupWorld, label: string, account = ACCOUNT, groups?: readonly PermissionGroup[]): WorldToken {
  return world.addToken("token", tokenValue(label), tokenId(label), { account, ...(groups === undefined ? {} : { groups }) });
}

const dirs: string[] = [];

/** Removes every project folder made so far. */
export function removeProjects(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

export interface ProjectOptions {
  /** A git repository (default true). */
  readonly repo?: boolean;
  /** `.gitignore`'s text (default `.env.cloudflare` listed); null for none. */
  readonly gitignore?: string | null;
  /** An old `.env.cloudflare`'s text (DEC-0799: never read); absent for no file. */
  readonly oldEnvFile?: string;
  /** Whether the local setup has been done already (default true). */
  readonly localSetupDone?: boolean;
}

/** The secret the fake app declares (its local value is set by the local setup). */
export const DECLARED_SECRETS = ["apiKey"];

/** A project folder: a small app (`package.json` with no dependencies), with its local setup done. */
export async function project(options: ProjectOptions = {}): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "setup-ac-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "setup-ac-app", private: true, type: "module" }, null, 2)}\n`);
  if (options.repo !== false) git(dir, ["init", "-q"]);
  const gitignore = options.gitignore === undefined ? ".env.cloudflare\n" : options.gitignore;
  if (gitignore !== null) writeFileSync(join(dir, ".gitignore"), gitignore);
  if (options.oldEnvFile !== undefined) writeFileSync(join(dir, ".env.cloudflare"), options.oldEnvFile);
  if (options.localSetupDone !== false) {
    // Dependencies (none) and local secrets; the `.gitignore` step is left as the options set it.
    await runLocalSetup(dir, { declaredSecrets: async () => DECLARED_SECRETS, npmInstall: () => Promise.reject(new Error("no install expected")), ensureIgnored: () => "already" });
  }
  return dir;
}

/** A home directory; with `secrets`, its `~/.secrets/cloudflare` holds that text at `mode` (default 600). */
export function home(secrets?: string, mode = 0o600): string {
  const dir = mkdtempSync(join(tmpdir(), "setup-ac-home-"));
  dirs.push(dir);
  if (secrets !== undefined) {
    mkdirSync(join(dir, ".secrets"), { recursive: true });
    writeFileSync(join(dir, ".secrets", "cloudflare"), secrets, { mode });
    chmodSync(join(dir, ".secrets", "cloudflare"), mode);
  }
  return dir;
}

/** The default secrets file of a home directory (PAR-450). */
export const secretsFile = (homeDir: string): string => join(homeDir, ".secrets", "cloudflare");

/** The secrets file's text: the two settings. */
export const credential = (token: string, account = ACCOUNT): string => `CLOUDFLARE_API_TOKEN=${token}\nCLOUDFLARE_ACCOUNT_ID=${account}\n`;

export function git(dir: string, args: readonly string[]): string {
  return execFileSync("git", ["-c", "user.name=setup-ac", "-c", "user.email=setup-ac@example.invalid", ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// ---------------------------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------------------------

export interface RunOptions {
  /** The process environment (default none of the settings). */
  readonly env?: Readonly<Record<string, string>>;
  /** The home directory (default a new, empty one). */
  readonly home?: string;
  readonly args?: readonly string[];
  /** The Cloudflare API per token (default the world's). */
  readonly apiFor?: (token: string) => CloudflareApi;
  /** Hosts the network check cannot reach: matched against the URL. */
  readonly blocked?: (url: string) => boolean;
  readonly localSetup?: CloudflareSetupCommandDeps["localSetup"];
}

export interface RunResult {
  readonly status: number;
  readonly out: string;
  readonly err: string;
  readonly all: string;
  /** How many times the command read standard input. */
  readonly stdinReads: number;
  /** URLs the network check tried. */
  readonly reached: readonly string[];
  /** The world's requests made by this run. */
  readonly requests: readonly string[];
}

/** Requests that change something (not a GET; a GraphQL query is a read). */
export const writesOf = (requests: readonly string[]): string[] => requests.filter((r) => !/ GET /.test(r) && !r.endsWith(" POST /graphql"));

/** Token updates or deletions among the requests. */
export const tokenWritesOf = (requests: readonly string[]): string[] => requests.filter((r) => / (PUT|DELETE) \/(accounts\/[^/]+|user)\/tokens\//.test(r));

function filesUnder(dir: string, skip: readonly string[], at = dir): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(at)) {
    const full = join(at, name);
    const rel = relative(dir, full);
    if (skip.includes(rel)) continue;
    if (statSync(full).isDirectory()) Object.assign(out, filesUnder(dir, skip, full));
    else out[rel] = readFileSync(full, "utf8");
  }
  return out;
}

/** Runs `cloudflare-setup` in `dir` against `world`, and records its output for SETUP-AC-010. */
export async function runSetup(label: string, world: SetupWorld, dir: string, options: RunOptions = {}): Promise<RunResult> {
  worlds.add(world);
  let stdinReads = 0;
  const io = {
    cwd: dir,
    out: "",
    err: "",
    stdout(text: string) {
      io.out += text;
    },
    stderr(text: string) {
      io.err += text;
    },
    stdin: {
      [Symbol.asyncIterator]() {
        stdinReads += 1;
        return { next: async () => ({ done: true as const, value: undefined }) };
      },
    } as AsyncIterable<string>,
  };
  const reached: string[] = [];
  const before = world.requests.length;
  const homeDir = options.home ?? home();
  const status = await cloudflareSetupCommand({
    env: options.env ?? {},
    home: homeDir,
    authAppSource: () => 'export default { fetch() { return new Response("auth app"); } };',
    frameworkVersion: "0.0.0-test",
    apiFor: options.apiFor ?? world.apiFor,
    reach: async (url) => {
      reached.push(url);
      if (options.blocked?.(url) === true) throw new Error("blocked");
    },
    localSetup: options.localSetup ?? ((d, o) => runLocalSetup(d, { ...o, declaredSecrets: async () => DECLARED_SECRETS, npmInstall: () => Promise.reject(new Error("no install expected")) })),
    stepOptions: { newSubdomain: () => SUB },
  })([...(options.args ?? [])], io);
  const requests = world.requests.slice(before);
  const files = { ...filesUnder(dir, [".git", ".env.cloudflare", "node_modules"]), ...Object.fromEntries(Object.entries(filesUnder(homeDir, [join(".secrets", "cloudflare")])).map(([k, v]) => [`~/${k}`, v])) };
  RUNS.push({ label, out: io.out, err: io.err, files });
  return { status, out: io.out, err: io.err, all: io.out + io.err, stdinReads, reached, requests };
}

/** The account set up as an earlier run (or the admin app) left it: every step and the setup record, through the fake's own API. */
export async function setUpAccount(world: SetupWorld, account = ACCOUNT): Promise<void> {
  // `ACCOUNT` is right for every account: each `FakeCloud` answers under the fake's own account ID (the world maps the real one to it).
  await applySetupSteps(world.cloud(account).api, ACCOUNT, {
    steps: SETUP_STEPS,
    setupVersion: ACCOUNT_SETUP_VERSION,
    frameworkVersion: "0.0.0-test",
    now: () => new Date(),
    newSubdomain: () => SUB,
  });
}

/** The lines of `text` equal (after trimming) to `line`. */
export const linesEqual = (text: string, line: string): number => text.split("\n").filter((l) => l.trim() === line).length;

/** Whether `needle` occurs in `text` set off by a rule line (a line of one repeated mark, 10 or more) above and below it. */
export function setOffByRules(text: string, needle: RegExp): boolean {
  const lines = text.split("\n");
  const rule = /^\s*([=\-*#_~])\1{9,}\s*$/;
  for (let i = 0; i < lines.length; i++) {
    if (!needle.test(lines[i] ?? "")) continue;
    let up = i - 1;
    while (up >= 0 && !rule.test(lines[up] ?? "") && (lines[up] ?? "").trim() !== "") up--;
    let down = i + 1;
    while (down < lines.length && !rule.test(lines[down] ?? "") && (lines[down] ?? "").trim() !== "") down++;
    if (up >= 0 && rule.test(lines[up] ?? "") && down < lines.length && rule.test(lines[down] ?? "")) return true;
  }
  return false;
}

/** The names of the permission groups a deep link pre-fills, and its token name. */
export function decodeLink(link: string, groups: readonly PermissionGroup[]): { names: string[]; tokenName: string | null; unknownKeys: string[] } {
  const url = new URL(link);
  const keys = JSON.parse(url.searchParams.get("permissionGroupKeys") ?? "[]") as { key: string }[];
  const names: string[] = [];
  const unknownKeys: string[] = [];
  for (const k of keys) {
    const g = groups.find((x) => x.id === k.key);
    if (g === undefined) unknownKeys.push(k.key);
    else names.push(g.name);
  }
  return { names, tokenName: url.searchParams.get("name"), unknownKeys };
}

/** `apiFor` whose replies to matching requests are replaced. */
export function withReplies(world: SetupWorld, replace: (method: string, path: string) => ApiReply | undefined): (token: string) => CloudflareApi {
  return (token) => {
    const api = world.apiFor(token);
    return async (method, path, body) => {
      const r = replace(method, path);
      if (r !== undefined) {
        world.requests.push(`(replaced) ${method} ${path}`);
        return r;
      }
      return api(method, path, body);
    };
  };
}

export const SERVER_ERROR: ApiReply = { status: 500, body: { success: false, errors: [{ code: 10000, message: "injected failure" }], messages: [], result: null } };
