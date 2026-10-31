/**
 * Shared support for the SETUP criteria (docs/components/setup.md §4, SETUP-AC-001…010): projects
 * in temporary folders, runs of `cloudflare-setup` against the fake Cloudflare API, and the record
 * of every run's output that SETUP-AC-010 searches.
 *
 * Written from setup.md, cli.md and plan-setup-wizard §3–§4, not from the command's code. The
 * command is the framework CLI's own `cloudflare-setup` (`cloudflareSetupCommand`: its argument
 * parsing, the settings sources, the local setup and the git checks are the real ones); only the
 * Cloudflare API (`SetupWorld` on `FakeCloud`, the in-memory account the framework's tests use,
 * shapes recorded from the live API), the network check's reach and the local setup's
 * `npm install` and secret names are injected. No network.
 *
 * Every fake sensitive value carries the run's marker (plan §6: "a fake token with a marker
 * string, searched for in every output"): token values, token IDs, the second account's ID, the
 * workers.dev subdomains. The fake's own account ID and zone IDs are registered too.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { cloudflareSetupCommand, type CloudflareSetupCommandDeps } from "../../../../../packages/framework/src/cli/commands/cloudflare-setup.js";
import type { ApiReply, CloudflareApi } from "../../../../../packages/framework/src/provision/cloudflare/api.js";
import { ACCOUNT, FakeCloud } from "../../../../../packages/framework/src/provision/cloudflare/fake-cloud.test-support.js";
import { ACCOUNT_SETUP_VERSION, deepLink, EVERYDAY, BOOTSTRAP, type PermissionGroup, type TokenPolicy } from "../../../../../packages/framework/src/provision/cloudflare/permissions.js";
import { applySetupSteps, SETUP_STEPS } from "../../../../../packages/framework/src/provision/cloudflare/setup-steps.js";
import { SetupWorld, type WorldToken } from "../../../../../packages/framework/src/provision/cloudflare/setup-world.test-support.js";
import { runLocalSetup } from "../../../../../packages/framework/src/provision/core/local-setup.js";

export { ACCOUNT, FakeCloud, SetupWorld, type WorldToken, type ApiReply, type CloudflareApi, type TokenPolicy, type PermissionGroup };

/** This run's marker, in every fake sensitive value. */
export const MARK = `setupac${randomBytes(4).toString("hex")}`;

/** The second account (the account-switch and several-accounts criteria): its ID carries the marker. */
export const SECOND_ACCOUNT = `${MARK}${randomBytes(9).toString("hex")}`.slice(0, 32);

/** The email domain the projects use: a zone of the fake account. */
export const DOMAIN = "example.test";

/** The settings' names (setup.md SETUP-REQ-002, PAR-340). */
export const BOOTSTRAP_SETTING = "CLOUDFLARE_BOOTSTRAP_TOKEN";
export const EVERYDAY_SETTING = "CLOUDFLARE_API_TOKEN";

/** PAR-342: the bootstrap token's line after use. */
export const BOOTSTRAP_DELETED_LINE = "# CLOUDFLARE_BOOTSTRAP_TOKEN=deleted by setup process";

/** PAR-343: the `.gitignore` marker that keeps setup from adding `.env.cloudflare`. */
export const KEEP_TRACKED_MARKER = "# keep-env-cloudflare-tracked";

/** PAR-361: the setting naming token IDs setup never updates or deletes. */
export const PROTECTED_IDS_SETTING = "PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS";

/** Plan §3.2's template, exactly its four lines (SETUP-REQ-003). */
export const TEMPLATE_LINES = [
  "CLOUDFLARE_BOOTSTRAP_TOKEN=",
  "CLOUDFLARE_API_TOKEN=",
  "CLOUDFLARE_EMAIL_DOMAIN=",
  "# CLOUDFLARE_ACCOUNT_ID=        (only if your tokens see more than one account)",
] as const;

/** The next prompt (plan §3.2, SETUP-REQ-003). */
export const NEXT_PROMPT_PHRASE = "continue prototype setup";

export const BOOT_LINK = deepLink("bootstrap");
export const EVERYDAY_LINK = deepLink("everyday");

/** Plan §4.1's everyday list and v0.2.0 plan §5.1's bootstrap list, by name (PAR-331 version 2). */
export const EVERYDAY_NAMES = ["Workers Scripts Write", "Workers R2 Storage Write", "D1 Write", "Email Sending Read", "Zone Read", "Analytics Read", "Email Routing Rules Read"];
export const BOOTSTRAP_NAMES = ["Workers Scripts Write", "OAuth Client Write", "Secrets Store Write", "Account API Tokens Write"];

/** The permission group of either list with this name. */
export function group(name: string): PermissionGroup {
  const g = [...EVERYDAY, ...BOOTSTRAP].find((x) => x.name === name);
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
  /** Files of the project the run left, other than `.env.cloudflare` and `.git/`, with their text. */
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
  // The OAuth client secrets the bootstrap's creates showed once (v0.2.0 plan §5.1 step 2).
  for (const w of worlds) for (const a of w.accounts.values()) for (const c of a.cloud.oauthClients.values()) all.set(c.secret, "an OAuth client secret");
  return all;
}

/** The (run label, value label) pairs where a recorded output holds a sensitive value. */
export function sensitiveHits(runs: readonly RecordedRun[] = RUNS): string[] {
  const values = sensitiveValues();
  const hits: string[] = [];
  for (const r of runs) {
    // The bootstrap prints the admin app's URL, which holds the subdomain (v0.2.0 plan §5.1 step 5; DEC-0686): that URL alone is allowed, on standard output.
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

export interface Tokens {
  readonly everyday: WorldToken;
  readonly bootstrap: WorldToken;
}

/** 12 hours from now: a bootstrap token within PAR-435's 1-day expiry (v0.2.0 plan §5.1; supersedes PAR-380's 7 days). */
export const EXPIRES = new Date(Date.now() + 12 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Two days from now: a bootstrap token setup deletes at once (more than 1 day away). */
export const EXPIRES_TOO_LATE = new Date(Date.now() + 48 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");

/** An everyday and a bootstrap token made from the deep links on `account`. */
export function addTokens(world: SetupWorld, label: string, account = ACCOUNT, options: { bootstrapExpires?: string | null } = {}): Tokens {
  const expires = options.bootstrapExpires === null ? {} : { expires_on: options.bootstrapExpires ?? EXPIRES };
  return {
    everyday: world.addToken("everyday", tokenValue(`${label}-everyday`), tokenId(`${label}e`), { account }),
    bootstrap: world.addToken("bootstrap", tokenValue(`${label}-bootstrap`), tokenId(`${label}b`), { account, ...expires }),
  };
}

/** A further bootstrap token on the account (each run that needs one gets its own). */
export function addBootstrap(world: SetupWorld, label: string, account = ACCOUNT, expires: string | null = EXPIRES): WorldToken {
  return world.addToken("bootstrap", tokenValue(`${label}-bootstrap`), tokenId(`${label}b`), { account, ...(expires === null ? {} : { expires_on: expires }) });
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
  /** `.env.cloudflare`'s text; absent for no file. */
  readonly envFile?: string;
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
  if (options.envFile !== undefined) writeFileSync(join(dir, ".env.cloudflare"), options.envFile);
  if (options.localSetupDone !== false) {
    // Dependencies (none) and local secrets; the `.gitignore` step is left as the options set it.
    await runLocalSetup(dir, { declaredSecrets: async () => DECLARED_SECRETS, npmInstall: () => Promise.reject(new Error("no install expected")), ensureIgnored: () => "already" });
  }
  return dir;
}

export function git(dir: string, args: readonly string[]): string {
  return execFileSync("git", ["-c", "user.name=setup-ac", "-c", "user.email=setup-ac@example.invalid", ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** `.env.cloudflare` lines. */
export const envFile = (values: Readonly<Record<string, string>>): string =>
  Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";

export const readEnvFile = (dir: string): string => readFileSync(join(dir, ".env.cloudflare"), "utf8");
export const envFileExists = (dir: string): boolean => existsSync(join(dir, ".env.cloudflare"));

// ---------------------------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------------------------

export interface RunOptions {
  /** The process environment (default none of the settings). */
  readonly env?: Readonly<Record<string, string>>;
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

function projectFiles(dir: string, at = dir): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(at)) {
    const full = join(at, name);
    const rel = relative(dir, full);
    if (rel === ".git" || rel === ".env.cloudflare" || rel === "node_modules") continue;
    if (statSync(full).isDirectory()) Object.assign(out, projectFiles(dir, full));
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
  const status = await cloudflareSetupCommand({
    env: options.env ?? {},
    apiFor: options.apiFor ?? world.apiFor,
    reach: async (url) => {
      reached.push(url);
      if (options.blocked?.(url) === true) throw new Error("blocked");
    },
    localSetup: options.localSetup ?? ((d, o) => runLocalSetup(d, { ...o, declaredSecrets: async () => DECLARED_SECRETS, npmInstall: () => Promise.reject(new Error("no install expected")) })),
    stepOptions: { newSubdomain: () => SUB, email: { sleep: async () => {} } },
  })([...(options.args ?? [])], io);
  const requests = world.requests.slice(before);
  RUNS.push({ label, out: io.out, err: io.err, files: projectFiles(dir) });
  return { status, out: io.out, err: io.err, all: io.out + io.err, stdinReads, reached, requests };
}

/**
 * The account setup on the fake account, as the admin app's Account setup page does it since
 * v0.2.0 (plan §5.2 page 1; DEC-0682): every step and the setup record, through the fake's own API.
 */
export async function setUpAccount(world: SetupWorld, account = ACCOUNT): Promise<void> {
  await applySetupSteps(world.cloud(account).api, ACCOUNT, {
    emailDomain: DOMAIN,
    steps: SETUP_STEPS,
    setupVersion: ACCOUNT_SETUP_VERSION,
    frameworkVersion: "0.0.0-test",
    now: () => new Date(),
    newSubdomain: () => SUB,
    email: { sleep: async () => {} },
  });
}

/**
 * A first project set up from scratch with a fresh pair of tokens (the state SETUP-AC-002, -004,
 * -005 and -007 start from): the account set up (`setUpAccount`), then the bootstrap run;
 * exit 0 is required, with the output in the error otherwise.
 */
export async function setUpFirstProject(label: string): Promise<{ world: SetupWorld; dir: string; tokens: Tokens }> {
  const world = freshWorld();
  await setUpAccount(world);
  const tokens = addTokens(world, label);
  const dir = await project({ envFile: envFile({ [BOOTSTRAP_SETTING]: tokens.bootstrap.value, [EVERYDAY_SETTING]: tokens.everyday.value, CLOUDFLARE_EMAIL_DOMAIN: DOMAIN }) });
  const r = await runSetup(`${label}: first setup`, world, dir);
  if (r.status !== 0) throw new Error(`the first setup of ${label} did not complete (exit ${String(r.status)}):\n${r.all}`);
  return { world, dir, tokens };
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
