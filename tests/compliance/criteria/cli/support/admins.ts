/**
 * Support for the `admins` command criteria (docs/components/cli.md CLI-REQ-005, §2 `admins`;
 * CLI-AC-006, CLI-AC-007) and for AUTH-AC-005's admin-role part on `prodcheck`: running the
 * command, recording the outgoing requests of a CLI process, reading the mail sink through
 * `mail last --target cloudflare`, and the recorded deploy output and email domain of a cloud stage.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { MailMessage } from "../../../../../docs/contracts/ts/testing.js";
import { prerequisiteMissing } from "../../../harness/index.js";
import { cli, type CommandResult } from "../../core/support/processes.js";
import { REFERENCE_DIR } from "../../core/support/repo.js";
import type { MailReader } from "../../pwd/support.js";

const here = dirname(fileURLToPath(import.meta.url));
const REQUEST_RECORDER = join(here, "record-requests.mjs");

export interface AdminsOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/** `admins <args…>` through the package binary, in the reference app by default. */
export function admins(args: readonly string[], options: AdminsOptions = {}): Promise<CommandResult> {
  return cli(["admins", ...args], { cwd: options.cwd ?? REFERENCE_DIR, timeoutMs: 300_000, ...(options.env === undefined ? {} : { env: options.env }) });
}

export interface RequestRecording {
  /** Environment for the CLI process: preloads the recorder (record-requests.mjs). */
  readonly env: Readonly<Record<string, string>>;
  /** The recorded lines (`started`, then `<channel> <url>` per request). */
  lines(): Promise<string[]>;
  dispose(): Promise<void>;
}

/** A fresh recording of the outgoing requests of one CLI process. */
export async function recordRequests(): Promise<RequestRecording> {
  const dir = await mkdtemp(join(tmpdir(), "c-t4-requests-"));
  const file = join(dir, "requests.log");
  const preload = `--import=${pathToFileURL(REQUEST_RECORDER).href}`;
  const nodeOptions = [process.env.NODE_OPTIONS ?? "", preload].filter((s) => s !== "").join(" ");
  return {
    env: { NODE_OPTIONS: nodeOptions, COMPLIANCE_REQUEST_LOG: file },
    async lines() {
      try {
        return (await readFile(file, "utf8")).split("\n").filter((l) => l !== "");
      } catch {
        return [];
      }
    },
    dispose: () => rm(dir, { recursive: true, force: true }),
  };
}

/** A D1 API request (`/accounts/{account}/d1/…`) among recorded lines. */
export function d1ApiRequests(lines: readonly string[]): string[] {
  return lines.filter((l) => /\/d1\/database\b/.test(l) || /\/d1\//.test(l));
}

/** The mail sink, read by recipient with `mail last --to <address> --target cloudflare` (MAIL-REQ-005). */
export function sinkMail(appDir = REFERENCE_DIR): MailReader {
  const latest = async (address: string): Promise<MailMessage | undefined> => {
    const r = await cli(["mail", "last", "--to", address, "--target", "cloudflare"], { cwd: appDir, timeoutMs: 120_000 });
    if (r.status === 1) return undefined;
    if (r.status !== 0) throw new Error(`mail last --target cloudflare exited ${String(r.status)}: ${r.output.slice(-1500)}`);
    const start = r.output.indexOf("{");
    const v = JSON.parse(r.output.slice(start)) as Partial<Record<string, unknown>>;
    const text = (k: string): string => (typeof v[k] === "string" ? (v[k] as string) : "");
    return { to: text("to"), from: text("from"), subject: text("subject"), text: text("text"), html: text("html"), sentAt: text("sentAt") || text("time") };
  };
  return {
    latest,
    async all(address) {
      const m = await latest(address);
      return m === undefined ? [] : [m];
    },
  };
}

/** The stage's recorded deploy output `.framework/<target>/stages/<stage>.json` `{ publicOrigin }` (cli.md §2). */
export function recordedOrigin(target: string, stage: string, appDir = REFERENCE_DIR): string {
  const file = join(appDir, ".framework", target, "stages", `${stage}.json`);
  if (!existsSync(file)) prerequisiteMissing(`stage ${stage} has no recorded deploy output (${file}); the cloud run redeploys prodcheck before its production checks (COMPL §2)`);
  const v = JSON.parse(readFileSync(file, "utf8")) as { publicOrigin?: unknown };
  if (typeof v.publicOrigin !== "string" || v.publicOrigin === "") throw new Error(`${file} has no publicOrigin`);
  return v.publicOrigin.replace(/\/$/, "");
}

/** The account's email domain: `emailDomain` of the Cloudflare account settings record (MAIL-REQ-003, DEC-0514). */
export async function emailDomain(): Promise<string> {
  const { readObject, STATE_BUCKET } = await import("../../_cloud/r2.js");
  let text: string;
  try {
    text = await readObject(STATE_BUCKET, "framework/account.json");
  } catch (error) {
    return prerequisiteMissing(`the account settings record (framework/account.json in ${STATE_BUCKET}) could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  const v = JSON.parse(text) as { emailDomain?: unknown };
  if (typeof v.emailDomain !== "string" || v.emailDomain === "") return prerequisiteMissing("the account settings record has no emailDomain: run setup-account --target cloudflare --email-domain <domain>");
  return v.emailDomain;
}

/**
 * The `role` column (PWD-REQ-008) of the account with `email` in a Cloudflare stage's current
 * database, read with one SELECT through the D1 HTTP API. The stage must have exactly one
 * database (MIG §2: two mean a schema-changing deploy is in progress).
 */
export async function cloudRole(stage: string, email: string): Promise<unknown> {
  const { accountId, cfOk } = await import("../../_cloud/api.js");
  const { stageDatabases } = await import("../../_cloud/stage-resources.js");
  const dbs = await stageDatabases({ app: "reference", stage });
  if (dbs.length !== 1) throw new Error(`stage ${stage} has ${String(dbs.length)} databases, not one`);
  const result = await cfOk<readonly { readonly results?: readonly Record<string, unknown>[] }[]>("reading the account's role", "POST", `/accounts/${accountId()}/d1/database/${dbs[0]?.uuid ?? ""}/query`, {
    sql: "SELECT role FROM __framework_auth_user WHERE lower(email) = lower(?)",
    params: [email],
  });
  const rows = result[0]?.results ?? [];
  if (rows.length !== 1) throw new Error(`expected one account row for the test address on ${stage}, found ${String(rows.length)}`);
  return rows[0]?.["role"];
}

/** Needles found in a command's output, by label. */
export function leaks(output: string, needles: Readonly<Record<string, string | undefined>>): string[] {
  return Object.entries(needles)
    .filter(([, n]) => n !== undefined && n.length >= 6 && output.includes(n))
    .map(([label]) => label);
}
