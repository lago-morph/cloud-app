/**
 * `admins grant <email> | revoke <email> | list --target <t> --stage <s> [--confirm-production <s>]`
 * (CLI-REQ-005, cli.md §2; DEC-0521, DEC-0523): grants, revokes and lists the `admin` role of
 * accounts on a stage, written directly in the stage's database.
 *
 * - Locally (`--target local`; `--stage` may be left out and can only be `local`) it opens the
 *   app's persisted local D1 under `.wrangler/state`, as `dev` does, whether or not `dev` runs.
 * - On Cloudflare it finds the stage's current database by the anchored pattern (MIG §2) and sends
 *   `/query` requests through the D1 HTTP API with the deploy token. A stage with no database, or
 *   with more than one (a schema-changing deploy is in progress or was interrupted), is refused.
 * - A production stage (not `test-*`) is refused with exit 2 unless `--confirm-production <s>`
 *   repeats its name. The check runs before anything is read.
 * - `grant`/`revoke` read the account's `id`, `email_verified` and `role` by address (trimmed and
 *   lowercased, as BA stores it), then write the new list, or NULL when no role is left, with one
 *   `UPDATE … WHERE id = ?`. `role` is the only column written. An unknown address or an unverified
 *   account exits 1, changing nothing. A grant of a role already held, or a revoke of one not held,
 *   writes nothing and exits 0.
 * - Output: the account's user ID (`deriveUserId("password", id)`, as `/api/auth/me` shows it) and
 *   its roles; `list` prints address, user ID and roles per admin. Nothing else of the account
 *   table is ever selected, so no password hash, token or credential can be printed (CLI-REQ-004).
 */
import type { Target } from "../../core/identity.js";
import { AUTH_MODEL_NAMES } from "../../auth/password/tables.js";
import { ADMIN_ROLE, formatRoles, parseRoles, withRole, withoutRole } from "../../auth/roles.js";
import { deriveUserId } from "../../auth/user-id.js";
import { parseOptions, TARGETS, UsageError } from "../args.js";
import { EXIT, type Command } from "../io.js";
import { checkedStage, refuseUnreachableCloud, type ProcessEnvironment } from "./smoke-cloud.js";

/** One SQL statement against the stage's database (sqlite: local D1 and Cloudflare D1). */
export interface AccountsDatabase {
  query(sql: string, params: readonly (string | number | null)[]): Promise<Record<string, unknown>[]>;
}

/** An open stage database; `close` releases it (the local platform proxy). */
export interface OpenedDatabase {
  readonly db: AccountsDatabase;
  close(): Promise<void>;
}

export interface AdminsDeps {
  readonly env: ProcessEnvironment;
  /** The app's name (`defineApp`). */
  appName(appDir: string): Promise<string>;
  /** The app's persisted local D1 (the one `dev` uses). */
  openLocal(appDir: string): Promise<OpenedDatabase>;
  /** Names of the missing Cloudflare credential variables (checked before anything is read). */
  missingCredentials?(): readonly string[];
  /** The stage's current D1 database on Cloudflare, through the D1 HTTP API. */
  openCloudflare(input: { readonly app: string; readonly stage: string }): Promise<OpenedDatabase>;
}

type Action = "grant" | "revoke" | "list";

interface Parsed {
  readonly action: Action;
  readonly email: string | undefined;
  readonly target: Target;
  readonly stage: string;
}

const CONFIRM = "confirm-production";
const USAGE = "usage: admins grant <email> | revoke <email> | list --target <local|cloudflare> --stage <stage> [--confirm-production <stage>]";
const USER = AUTH_MODEL_NAMES.user;
/** The password provider's id (`PASSWORD_PROVIDER_ID`), named here so the command does not load the credential library. */
const PASSWORD_PROVIDER_ID = "password";

/** A refusal with exit 1 that changes nothing. */
export class Refused extends Error {}

/** Addresses as BA stores them. */
export function normalizeAddress(email: string): string {
  return email.trim().toLowerCase();
}

export function parseAdminsArgs(args: readonly string[]): Parsed {
  const [action, ...rest] = args;
  if (action !== "grant" && action !== "revoke" && action !== "list") throw new UsageError(USAGE);
  let email: string | undefined;
  let options = rest;
  if (action !== "list") {
    const [first, ...others] = rest;
    if (first === undefined || first.startsWith("--")) throw new UsageError(`admins ${action} needs an email address; ${USAGE}`);
    email = normalizeAddress(first);
    if (!email.includes("@")) throw new UsageError(`admins ${action}: the first argument must be an email address`);
    options = others;
  }
  const parsed = parseOptions(options, ["target", "stage", CONFIRM]);
  const target = parsed.get("target");
  if (target === undefined) throw new UsageError("--target is missing");
  if (!(TARGETS as readonly string[]).includes(target)) throw new UsageError(`--target must be one of: ${TARGETS.join(", ")}`);
  const confirmed = parsed.get(CONFIRM);
  if (target === "local") {
    const stage = parsed.get("stage") ?? "local";
    if (stage !== "local") throw new UsageError("with --target local the stage can only be local");
    if (confirmed !== undefined) throw new UsageError(`--${CONFIRM} is only for production stages on a cloud target`);
    return { action, email, target: "local", stage };
  }
  const stage = parsed.get("stage");
  if (stage === undefined) throw new UsageError("--stage is missing");
  checkedStage(stage);
  if (stage.startsWith("test-")) {
    if (confirmed !== undefined) throw new UsageError(`--${CONFIRM} is only for production stages; ${stage} is a test stage`);
  } else if (confirmed !== stage) {
    throw new UsageError(
      `${stage} is a production stage: admins reads or changes it only when the stage is confirmed; add --${CONFIRM} ${stage}`,
    );
  }
  return { action, email, target: target as Target, stage };
}

const rolesText = (roles: readonly string[]): string => (roles.length === 0 ? "none" : roles.join(","));

async function change(db: AccountsDatabase, parsed: Parsed, email: string): Promise<string> {
  const rows = await db.query(`SELECT id, email_verified, role FROM "${USER}" WHERE email = ?`, [email]);
  const row = rows[0];
  const verified = row !== undefined && (row["email_verified"] === 1 || row["email_verified"] === true || row["email_verified"] === "1");
  if (row === undefined || !verified || typeof row["id"] !== "string") throw new Refused(`no verified account with this address on ${parsed.stage}`);
  const id = row["id"];
  const stored = typeof row["role"] === "string" ? row["role"] : null;
  const before = parseRoles(stored);
  const after = parsed.action === "grant" ? withRole(before, ADMIN_ROLE) : withoutRole(before, ADMIN_ROLE);
  const next = formatRoles(after);
  if (next !== stored) await db.query(`UPDATE "${USER}" SET role = ? WHERE id = ?`, [next, id]);
  const userId = await deriveUserId(PASSWORD_PROVIDER_ID, id);
  return `${parsed.action === "grant" ? "granted" : "revoked"} admin on ${parsed.stage}: user ${userId}, roles ${rolesText(after)}\n`;
}

async function list(db: AccountsDatabase, parsed: Parsed): Promise<string> {
  const rows = await db.query(`SELECT email, id, role FROM "${USER}" WHERE role IS NOT NULL ORDER BY email`, []);
  const lines: string[] = [];
  for (const row of rows) {
    const roles = parseRoles(typeof row["role"] === "string" ? row["role"] : null);
    if (!roles.includes(ADMIN_ROLE) || typeof row["id"] !== "string") continue;
    lines.push(`${String(row["email"])}  ${await deriveUserId(PASSWORD_PROVIDER_ID, row["id"])}  ${rolesText(roles)}`);
  }
  return lines.length === 0 ? `no admins on ${parsed.stage}\n` : `${lines.join("\n")}\n`;
}

export function adminsCommand(deps: AdminsDeps): Command {
  return async (args, io) => {
    // Usage and the production confirmation come first: nothing is read before them.
    const parsed = parseAdminsArgs(args);
    if (parsed.target !== "local") {
      const refused = refuseUnreachableCloud("admins", deps.env, io);
      if (refused !== undefined) return refused;
      const missing = deps.missingCredentials?.() ?? [];
      if (missing.length > 0) {
        io.stderr(`admins failed: missing Cloudflare credentials: ${missing.join(", ")} (set them in the environment; values are never printed)\n`);
        return EXIT.failed;
      }
    }
    let opened: OpenedDatabase;
    try {
      opened = parsed.target === "local" ? await deps.openLocal(io.cwd) : await deps.openCloudflare({ app: await deps.appName(io.cwd), stage: parsed.stage });
    } catch (error) {
      if (error instanceof Refused) {
        io.stderr(`admins: ${error.message}\n`);
        return EXIT.failed;
      }
      throw error;
    }
    try {
      const out = parsed.action === "list" ? await list(opened.db, parsed) : await change(opened.db, parsed, parsed.email ?? "");
      io.stdout(out);
      return EXIT.ok;
    } catch (error) {
      if (error instanceof Refused) {
        io.stderr(`admins: ${error.message}\n`);
        return EXIT.failed;
      }
      throw error;
    } finally {
      await opened.close();
    }
  };
}

/**
 * The stage's current D1 database on Cloudflare through the D1 HTTP API: exactly one database
 * matching `^<app>-<stage>-db-(\d+)$` (MIG §2), else a refusal. Each query is one `/query` request.
 */
export async function openCloudflareDatabase(options: {
  readonly api: import("../../provision/cloudflare/api.js").CloudflareApi;
  readonly accountId: string;
  readonly app: string;
  readonly stage: string;
}): Promise<OpenedDatabase> {
  const [{ d1Client }, { matchStageDatabases }] = await Promise.all([import("../../provision/cloudflare/d1/client.js"), import("../../provision/core/databases.js")]);
  const client = d1Client(options.api, options.accountId);
  const found = matchStageDatabases({ app: options.app, stage: options.stage }, await client.list());
  if (found.length === 0) throw new Refused(`stage ${options.stage} of ${options.app} has no D1 database on Cloudflare (deploy it first)`);
  if (found.length > 1) {
    throw new Refused(
      `stage ${options.stage} has ${found.length} D1 databases (${found.map((d) => d.name).join(", ")}): a schema-changing deploy is in progress or was interrupted; run deploy again, then retry`,
    );
  }
  const uuid = (found[0] as { id: string }).id;
  return {
    db: {
      async query(sql, params) {
        const [rows] = await client.batch(uuid, [{ sql, params }]);
        return rows ?? [];
      },
    },
    close: async () => undefined,
  };
}

/** `admins` bound to the app loader, the local D1 and the Cloudflare D1 HTTP API. */
export async function adminsBinding(env: ProcessEnvironment = process.env, fetchImpl?: typeof fetch): Promise<Command> {
  const [{ loadApp }, { createCloudflareApi }, { missingCredentials }] = await Promise.all([
    import("../../build/load.js"),
    import("../../provision/cloudflare/api.js"),
    import("../../provision/cloudflare/environment.js"),
  ]);
  return adminsCommand({
    env,
    appName: async (appDir) => (await loadApp(appDir)).definition.name,
    openLocal: openLocalDatabase,
    missingCredentials: () => missingCredentials(env),
    async openCloudflare({ app, stage }) {
      const api = createCloudflareApi({ token: env.CLOUDFLARE_API_TOKEN ?? "", ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }) });
      return openCloudflareDatabase({ api, accountId: env.CLOUDFLARE_ACCOUNT_ID ?? "", app, stage });
    },
  });
}

/** The app's persisted local D1, through Wrangler's `getPlatformProxy` with `dev`'s configuration and state. */
export async function openLocalDatabase(appDir: string): Promise<OpenedDatabase> {
  const [{ existsSync }, { devPaths }, { getPlatformProxy }] = await Promise.all([import("node:fs"), import("../dev/plan.js"), import("wrangler")]);
  const paths = devPaths(appDir);
  if (!existsSync(paths.wranglerConfig) || !existsSync(paths.persistTo)) {
    throw new Refused("there is no local database yet: run npm run dev once, sign up and verify, then retry");
  }
  type Binding = { prepare(sql: string): { bind(...values: unknown[]): { all(): Promise<{ results?: Record<string, unknown>[] }> } } };
  const proxy = await getPlatformProxy<{ DB: Binding }>({ configPath: paths.wranglerConfig, persist: { path: paths.platformProxyPersist } });
  return {
    db: {
      async query(sql, params) {
        return (await proxy.env.DB.prepare(sql).bind(...params).all()).results ?? [];
      },
    },
    close: () => proxy.dispose(),
  };
}
