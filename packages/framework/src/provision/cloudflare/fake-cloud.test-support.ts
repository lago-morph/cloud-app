/**
 * An in-memory Cloudflare account for the target's unit tests: the API endpoints the target
 * uses, with the request and response shapes recorded by spikes A-01, A-03, A-04 and A-07, a
 * fake SST CLI that creates and removes what the generated program declares (and, like the
 * real one, leaves the stage's state objects behind), and in-memory D1 database operations
 * standing in for D-04's. No network.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Migration } from "../../mig/history.js";
import type { MigrationDatabase } from "../../mig/apply.js";
import type { ListedDatabase, StageDatabase } from "../core/operations.js";
import type { ApiReply, CloudflareApi } from "./api.js";
import type { CloudflareDatabases } from "./databases.js";
import type { SstExec } from "./sst.js";

export const ACCOUNT = "0123456789abcdef0123456789abcdef";
const A = `/accounts/${ACCOUNT}`;

const ok = (result: unknown, extra: Record<string, unknown> = {}): ApiReply => ({ status: 200, body: { success: true, errors: [], messages: [], result, ...extra } });
const err = (status: number, code: number, message: string): ApiReply => ({ status, body: { success: false, errors: [{ code, message }], messages: [], result: null } });

export interface FakeWorker {
  secrets: Map<string, string>;
  enabled: boolean;
  previews: boolean;
  bindings: { type: string; name: string }[];
}

export class FakeCloud {
  readonly buckets = new Map<string, Set<string>>();
  readonly cors = new Map<string, unknown>();
  readonly tokens = new Map<string, { name: string; resources: unknown }>();
  readonly workers = new Map<string, FakeWorker>();
  subdomain: string | undefined = "example";
  readonly requests: string[] = [];
  readonly sstRuns: string[] = [];
  readonly programs: string[] = [];
  /** Replies that replace the fake's own for `<METHOD> <path>`. */
  readonly override = new Map<string, ApiReply | (() => ApiReply)>();
  /** SST commands (`deploy`, `remove`) that fail. */
  readonly failSst = new Set<string>();
  private nextToken = 1;

  readonly api: CloudflareApi = async (method, path, body) => {
    this.requests.push(`${method} ${path}`);
    const o = this.override.get(`${method} ${path}`);
    if (o) return typeof o === "function" ? o() : o;
    return this.handle(method, path, body);
  };

  private handle(method: string, path: string, body: unknown): ApiReply {
    const url = new URL(`https://api${path}`);
    const p = url.pathname;
    const b = body as Record<string, unknown>;
    if (p === `${A}/tokens/verify`) return ok({ status: "active" });
    if (p === `${A}/tokens/permission_groups`) return ok([{ id: "2efd5506f9c8494dacb1fa10a3e7d5b6", name: "Workers R2 Storage Bucket Item Write" }]);
    if (p === `${A}/tokens` && method === "GET") return ok([...this.tokens].map(([id, t]) => ({ id, name: t.name })), { result_info: { page: 1, total_pages: 1 } });
    if (p === `${A}/tokens` && method === "POST") {
      const id = `tok${this.nextToken++}`;
      this.tokens.set(id, { name: String(b.name), resources: (b.policies as { resources: unknown }[])[0]!.resources });
      return ok({ id, name: b.name, status: "active", value: `value-of-${id}` });
    }
    let m = /^\/accounts\/[^/]+\/tokens\/([^/]+)$/.exec(p);
    if (m && method === "DELETE") return this.tokens.delete(m[1]!) ? ok({ id: m[1] }) : err(404, 1003, "not found");

    if (p === `${A}/workers/subdomain`) {
      if (method === "PUT") {
        this.subdomain = String(b.subdomain);
        return ok({ subdomain: this.subdomain });
      }
      return this.subdomain === undefined ? err(404, 10007, "no subdomain") : ok({ subdomain: this.subdomain });
    }
    m = /^\/accounts\/[^/]+\/workers\/scripts\/([^/]+)(\/.*)?$/.exec(p);
    if (m) {
      const w = this.workers.get(m[1]!);
      const rest = m[2] ?? "";
      if (!w) return err(404, 10007, "This Worker does not exist on your account.");
      if (rest === "/settings") return ok({ bindings: w.bindings });
      if (rest === "" && method === "DELETE") {
        this.workers.delete(m[1]!);
        return ok(null);
      }
      if (rest === "/secrets" && method === "PUT") {
        w.secrets.set(String(b.name), String(b.text));
        return ok({ name: b.name, type: "secret_text" });
      }
      if (rest === "/secrets" && method === "GET") return ok([...w.secrets.keys()].map((name) => ({ name, type: "secret_text" })));
      if (rest === "/subdomain" && method === "POST") {
        w.enabled = b.enabled === true;
        // A body without previews_enabled turns previews on (A-04 t02).
        w.previews = b.previews_enabled === undefined ? true : b.previews_enabled === true;
        return ok({ enabled: w.enabled, previews_enabled: w.previews });
      }
      if (rest === "/subdomain" && method === "GET") return ok({ enabled: w.enabled, previews_enabled: w.previews });
    }
    if (p === `${A}/r2/buckets` && method === "POST") {
      if (this.buckets.has(String(b.name))) return err(409, 10004, "The bucket you tried to create already exists.");
      this.buckets.set(String(b.name), new Set());
      return ok({ name: b.name });
    }
    m = /^\/accounts\/[^/]+\/r2\/buckets\/([^/]+)(\/.*)?$/.exec(p);
    if (m) {
      const name = m[1]!;
      const objects = this.buckets.get(name);
      const rest = m[2] ?? "";
      if (!objects) return err(404, 10006, "The specified bucket does not exist.");
      if (rest === "" && method === "GET") return ok({ name });
      if (rest === "" && method === "DELETE") {
        if (objects.size > 0) return err(409, 10008, "The bucket you tried to delete is not empty.");
        this.buckets.delete(name);
        return ok(null);
      }
      if (rest === "/cors" && method === "PUT") {
        this.cors.set(name, body);
        return ok(null);
      }
      if (rest === "/objects" && method === "GET") return ok([...objects].sort().map((key) => ({ key })), { result_info: { is_truncated: false } });
      if (rest.startsWith("/objects/") && method === "DELETE") {
        objects.delete(decodeURIComponent(rest.slice("/objects/".length)));
        return ok({});
      }
    }
    throw new Error(`fake Cloudflare: unexpected request ${method} ${path}`);
  }

  /** The fake SST CLI: reads the generated program's embedded input and applies it. */
  readonly sst: SstExec = async (args, options) => {
    const [command] = args;
    const stage = args[args.indexOf("--stage") + 1]!;
    this.sstRuns.push(args.join(" "));
    if (command === "install") {
      mkdirSync(join(options.cwd, ".sst", "platform"), { recursive: true });
      return { code: 0, output: "✓ Installed" };
    }
    if (this.failSst.has(command!)) return { code: 1, output: `✕ ${command} failed: injected` };
    const program = readFileSync(join(options.cwd, "sst.config.ts"), "utf8");
    this.programs.push(program);
    const input = JSON.parse(/const input = (\{[\s\S]*?\n\}) as const;/.exec(program)![1]!) as {
      app: string;
      filesBucket: string;
      worker?: { name: string; bindings: { type: string; name: string }[] };
    };
    const stateKeys = [`app/${input.app}/${stage}`, `passphrase/${input.app}/${stage}`, `snapshot/${input.app}/${stage}/${this.sstRuns.length}`];
    if (command === "deploy") {
      if (!this.buckets.has(input.filesBucket)) this.buckets.set(input.filesBucket, new Set());
      const targeted = args.includes("--target");
      if (!targeted && input.worker) {
        const existing = this.workers.get(input.worker.name);
        // A deploy turns the workers.dev route on (A-04 w05, DEC-0091), keeping secrets (A-03).
        this.workers.set(input.worker.name, { secrets: existing?.secrets ?? new Map(), enabled: true, previews: false, bindings: input.worker.bindings });
      }
      const state = this.buckets.get("sst-state");
      for (const k of stateKeys) state?.add(k);
      return { code: 0, output: "✓ Complete" };
    }
    if (command === "remove") {
      for (const [name] of this.workers) if (name === `${input.app}-${stage}`) this.workers.delete(name);
      const files = this.buckets.get(input.filesBucket);
      if (files && files.size > 0) return { code: 1, output: "✕ Failed: bucket not empty" };
      this.buckets.delete(input.filesBucket);
      return { code: 0, output: "✓ Removed" };
    }
    return { code: 1, output: `unknown command ${command}` };
  };

  /** A deployed-looking account with its shared resources. */
  static withSharedResources(): FakeCloud {
    const c = new FakeCloud();
    c.buckets.set("prototype-logs", new Set());
    c.buckets.set("sst-state", new Set());
    return c;
  }
}

/** In-memory D1 operations (D-04 stand-in) recording calls. */
export class FakeDatabases implements CloudflareDatabases {
  readonly dbs = new Map<string, { name: string; recorded: Set<string> }>();
  readonly calls: string[] = [];
  private next = 1;

  async listDatabases(): Promise<readonly ListedDatabase[]> {
    this.calls.push("list");
    return [...this.dbs].map(([id, d]) => ({ id, name: d.name }));
  }
  async createDatabase(_stage: unknown, name: string): Promise<StageDatabase> {
    this.calls.push(`create ${name}`);
    const id = `uuid-${this.next++}`;
    this.dbs.set(id, { name, recorded: new Set() });
    return { id, name, number: Number(/-db-(\d+)$/.exec(name)![1]) };
  }
  async copyDatabase(_stage: unknown, from: StageDatabase, name: string): Promise<StageDatabase> {
    this.calls.push(`copy ${from.name} ${name}`);
    const id = `uuid-${this.next++}`;
    this.dbs.set(id, { name, recorded: new Set(this.dbs.get(from.id)!.recorded) });
    return { id, name, number: Number(/-db-(\d+)$/.exec(name)![1]) };
  }
  async dropDatabase(_stage: unknown, database: StageDatabase): Promise<void> {
    this.calls.push(`drop ${database.name}`);
    this.dbs.delete(database.id);
  }
  migrationDatabase(database: StageDatabase): MigrationDatabase {
    const db = this.dbs.get(database.id)!;
    return {
      dialect: "sqlite",
      recordedIds: async () => new Set(db.recorded),
      applyAtomically: async (migration: Migration) => void db.recorded.add(migration.id),
    };
  }
  async checkMigratedDatabase(): Promise<void> {
    this.calls.push("check");
  }
}
