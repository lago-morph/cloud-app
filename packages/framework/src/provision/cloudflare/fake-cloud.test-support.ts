/**
 * An in-memory Cloudflare account for the target's unit tests: the API endpoints the target
 * uses, with the request and response shapes recorded by spikes A-01, A-03, A-04 and A-07, a
 * fake SST CLI that models SST's per-stage state (see `sst` below; like the real one, it
 * leaves the stage's state objects behind), and in-memory D1 database operations
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
  /** Tags of a Worker uploaded through the scripts API (the mail sink). */
  tags?: string[];
  /** The uploaded modules by part name (the mail sink). */
  modules?: Map<string, string>;
}

/** The fake's own token: its ID and its policies (`GET /accounts/<a>/tokens/<id>`). */
export const SELF_TOKEN_ID = "selftoken";

/** Policies granting every permission the framework needs, in the live token's shape (2026-10-25). */
export const FULL_POLICIES = [
  {
    id: "p1",
    effect: "allow",
    resources: { [`com.cloudflare.api.account.${ACCOUNT}`]: "*" },
    permission_groups: ["Email Sending Write", "Email Routing Addresses Write", "Workers Scripts Write", "Workers R2 Storage Write", "Account API Tokens Write", "D1 Write"].map((name, i) => ({ id: `g${i}`, name })),
  },
  {
    id: "p2",
    effect: "allow",
    resources: { [`com.cloudflare.api.account.${ACCOUNT}`]: { "com.cloudflare.api.account.zone.*": "*" } },
    permission_groups: ["Email Routing Rules Write", "DNS Write", "Zone Settings Write", "Zone Read"].map((name, i) => ({ id: `z${i}`, name })),
  },
];

export interface FakeRoutingRule {
  id: string;
  name: string;
  enabled: boolean;
  matchers: { type: string; field?: string; value?: string }[];
  actions: { type: string; value?: string[] }[];
}

/** One zone's email state. */
export interface FakeZone {
  readonly id: string;
  readonly name: string;
  status: string;
  sending: { id: string; name: string; enabled: boolean; pollsUntilEnabled: number }[];
  /** Subdomains whose Email Routing MX/SPF records exist. */
  routedSubdomains: Set<string>;
  /** `GET …/dns_records` reads after a routing POST before its records show (propagation). */
  routingPollsLeft: number;
  /** Email Routing on the zone (`GET /zones/<z>/email/routing` `enabled`); a subdomain POST turns it on, as live. */
  routingEnabled: boolean;
  /** The zone's DNS records (`GET /zones/<z>/dns_records`). */
  dnsRecords: FakeDnsRecord[];
  supportSubaddress: boolean;
  rules: FakeRoutingRule[];
}

export interface FakeDnsRecord {
  name: string;
  type: string;
  content: string;
  priority?: number;
  ttl: number;
}

/** Email Routing's SPF TXT content, quoted as the API returns it. */
export const ROUTING_SPF = '"v=spf1 include:_spf.mx.cloudflare.net ~all"';

/** The records `GET /zones/<z>/email/routing/dns?subdomain=<sub>` lists for `sub`, exactly as live on 2026-10-25. */
export function routingRecordsFor(sub: string): FakeDnsRecord[] {
  return [
    { name: sub, content: "route1.mx.cloudflare.net.", type: "MX", priority: 96, ttl: 1 },
    { name: sub, content: "route2.mx.cloudflare.net.", type: "MX", priority: 97, ttl: 1 },
    { name: sub, content: "route3.mx.cloudflare.net.", type: "MX", priority: 97, ttl: 1 },
    { name: sub, content: ROUTING_SPF, type: "TXT", ttl: 1 },
  ];
}

export class FakeCloud {
  readonly buckets = new Map<string, Set<string>>();
  /** Bodies of objects written with `PUT …/objects/<key>`, by `<bucket>/<key>` (JSON values). */
  readonly objectBodies = new Map<string, unknown>();
  readonly cors = new Map<string, unknown>();
  readonly tokens = new Map<string, { name: string; resources: unknown }>();
  readonly workers = new Map<string, FakeWorker>();
  /** Zones by name: by default `example.test`, `one.example` and `two.example`, active. */
  readonly zones = new Map<string, FakeZone>();
  /** Lifecycle rules per bucket; a new bucket gets R2's default multipart-abort rule. */
  readonly lifecycles = new Map<string, unknown[]>();
  /** The policies `GET /accounts/<a>/tokens/<SELF_TOKEN_ID>` answers. */
  tokenPolicies: unknown[] = FULL_POLICIES;
  /** Polls a newly onboarded sending entry needs before it is enabled. */
  sendingPolls = 0;
  /** GETs of a newly routed subdomain's records before they show. */
  routingPolls = 0;
  /** Uploads whose parts `settleUploads` reads (FormData parts are Blobs, read asynchronously). */
  readonly pendingUploads: { name: string; form: FormData }[] = [];
  subdomain: string | undefined = "example";
  readonly requests: string[] = [];
  readonly sstRuns: string[] = [];
  readonly programs: string[] = [];
  /** Replies that replace the fake's own for `<METHOD> <path>`. */
  readonly override = new Map<string, ApiReply | (() => ApiReply)>();
  /** SST commands (`deploy`, `remove`) that fail. */
  readonly failSst = new Set<string>();
  /** SST's state per `<app>/<stage>`: the logical names of the components it holds. */
  readonly sstState = new Map<string, Set<string>>();
  private nextToken = 1;
  private nextZoneThing = 1;

  constructor() {
    for (const name of ["example.test", "one.example", "two.example"]) this.addZone(name);
  }

  /** Adds an active zone with the live account's initial email state (routing off, a disabled catch-all drop rule). */
  addZone(name: string): FakeZone {
    const zone: FakeZone = {
      id: `zone${this.nextZoneThing++}`,
      name,
      status: "active",
      sending: [],
      routedSubdomains: new Set(),
      routingPollsLeft: 0,
      routingEnabled: false,
      dnsRecords: [],
      supportSubaddress: false,
      rules: [{ id: `rule${this.nextZoneThing++}`, name: "", enabled: false, matchers: [{ type: "all" }], actions: [{ type: "drop" }] }],
    };
    this.zones.set(name, zone);
    return zone;
  }
  private nextUpdate = 1;

  readonly api: CloudflareApi = async (method, path, body) => {
    this.requests.push(`${method} ${path}`);
    const o = this.override.get(`${method} ${path}`);
    if (o) return typeof o === "function" ? o() : o;
    const reply = this.handle(method, path, body);
    if (this.pendingUploads.length > 0) await this.settleUploads();
    return reply;
  };

  private handle(method: string, path: string, body: unknown): ApiReply {
    const url = new URL(`https://api${path}`);
    const p = url.pathname;
    const b = body as Record<string, unknown>;
    if (p === `${A}/tokens/verify`) return ok({ id: SELF_TOKEN_ID, status: "active" });
    if (p === `${A}/tokens/${SELF_TOKEN_ID}` && method === "GET") return ok({ id: SELF_TOKEN_ID, name: "admin", status: "active", policies: this.tokenPolicies });
    if (p.startsWith("/zones")) return this.handleZone(method, url, body);
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
    if (m && m[2] === undefined && method === "PUT") return this.upload(m[1]!, body);
    if (m) {
      const w = this.workers.get(m[1]!);
      const rest = m[2] ?? "";
      if (!w) return err(404, 10007, "This Worker does not exist on your account.");
      if (rest === "/settings") return ok({ bindings: w.bindings, ...(w.tags === undefined ? {} : { tags: w.tags }) });
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
      if (this.buckets.has(String(b.name))) return err(409, 10004, "The bucket you tried to create already exists, and you own it.");
      this.buckets.set(String(b.name), new Set());
      this.lifecycles.set(String(b.name), [{ id: "Default Multipart Abort Rule", enabled: true, conditions: { prefix: "" }, abortMultipartUploadsTransition: { condition: { type: "Age", maxAge: 604800 } } }]);
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
      if (rest === "/lifecycle" && method === "GET") return ok({ rules: this.lifecycles.get(name) ?? [] });
      if (rest === "/lifecycle" && method === "PUT") {
        this.lifecycles.set(name, JSON.parse(JSON.stringify((body as { rules: unknown[] }).rules)) as unknown[]);
        return ok(null);
      }
      if (rest === "/objects" && method === "GET" && url.searchParams.has("prefix")) {
        const prefix = url.searchParams.get("prefix") ?? "";
        return ok([...objects].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })), { result_info: { is_truncated: false } });
      }
      if (rest === "/cors" && method === "PUT") {
        this.cors.set(name, body);
        return ok(null);
      }
      if (rest === "/objects" && method === "GET") return ok([...objects].sort().map((key) => ({ key })), { result_info: { is_truncated: false } });
      if (rest.startsWith("/objects/") && method === "DELETE") {
        const key = decodeURIComponent(rest.slice("/objects/".length));
        objects.delete(key);
        this.objectBodies.delete(`${name}/${key}`);
        return ok({});
      }
      // An object's own bytes (JSON, or text such as a raw message); the R2 object endpoints answer them unwrapped.
      if (rest.startsWith("/objects/") && method === "GET") {
        const key = decodeURIComponent(rest.slice("/objects/".length));
        if (!objects.has(key)) return err(404, 10007, "The specified key does not exist.");
        return { status: 200, body: this.objectBodies.get(`${name}/${key}`) ?? null };
      }
      if (rest.startsWith("/objects/") && method === "PUT") {
        const key = decodeURIComponent(rest.slice("/objects/".length));
        objects.add(key);
        this.objectBodies.set(`${name}/${key}`, JSON.parse(JSON.stringify(body)) as unknown);
        return ok({ key });
      }
    }
    throw new Error(`fake Cloudflare: unexpected request ${method} ${path}`);
  }

  /** `PUT …/workers/scripts/<name>` with a multipart body: the metadata part and the modules. */
  private upload(name: string, body: unknown): ApiReply {
    if (!(body instanceof FormData)) return err(400, 10021, "expected multipart/form-data");
    if (body.get("metadata") === null) return err(400, 10021, "no metadata part");
    this.pendingUploads.push({ name, form: body });
    const existing = this.workers.get(name);
    this.workers.set(name, { secrets: existing?.secrets ?? new Map(), enabled: existing?.enabled ?? true, previews: false, bindings: [], tags: [] });
    return ok({ id: name });
  }

  /** Reads every pending upload's metadata and modules into its fake Worker. */
  async settleUploads(): Promise<void> {
    for (const { name, form } of this.pendingUploads.splice(0)) {
      const w = this.workers.get(name)!;
      const meta = JSON.parse(await (form.get("metadata") as Blob).text()) as { bindings: { type: string; name: string }[]; tags?: string[] };
      w.bindings = meta.bindings;
      w.tags = meta.tags ?? [];
      w.modules = new Map();
      for (const [key, value] of form.entries()) if (key !== "metadata" && value instanceof Blob) w.modules.set(key, await value.text());
    }
  }

  private zoneById(id: string): FakeZone | undefined {
    return [...this.zones.values()].find((z) => z.id === id);
  }

  private handleZone(method: string, url: URL, body: unknown): ApiReply {
    const p = url.pathname;
    const b = body as Record<string, unknown>;
    if (p === "/zones" && method === "GET") {
      const name = url.searchParams.get("name");
      const zone = name === null ? undefined : this.zones.get(name);
      return ok(zone ? [{ id: zone.id, name: zone.name, status: zone.status, account: { id: ACCOUNT } }] : [], { result_info: { page: 1, total_pages: 1 } });
    }
    const dns = /^\/zones\/([^/]+)\/dns_records$/.exec(p);
    if (dns && method === "GET") {
      const z = this.zoneById(dns[1]!);
      if (!z) return err(404, 1001, "zone not found");
      const name = url.searchParams.get("name");
      // Records added by a routing POST show only after `routingPolls` reads (propagation).
      const hidden = z.routingPollsLeft-- > 0;
      const list = hidden ? [] : z.dnsRecords.filter((r) => name === null || r.name === name);
      return ok(list.map((r, i) => ({ id: `dns${i}`, name: r.name, type: r.type, content: r.content, ...(r.priority === undefined ? {} : { priority: r.priority }), ttl: r.ttl, locked: true })), { result_info: { page: 1, per_page: 100, count: list.length, total_count: list.length, total_pages: 1 } });
    }
    const m = /^\/zones\/([^/]+)\/email\/(sending\/subdomains|routing)(\/.*)?$/.exec(p);
    const zone = m ? this.zoneById(m[1]!) : undefined;
    if (!m || !zone) return err(404, 1001, "zone not found");
    const rest = m[3] ?? "";
    if (m[2] === "sending/subdomains") {
      const view = (e: FakeZone["sending"][number]) => ({ id: e.id, tag: e.id, name: e.name, enabled: e.enabled, return_path_domain: `cf-bounce.${e.name}` });
      if (rest === "" && method === "GET") return ok(zone.sending.map(view));
      if (rest === "" && method === "POST") {
        if (zone.sending.some((e) => e.name === b.name)) return err(409, 10000, "already exists");
        const e = { id: `send${this.nextZoneThing++}`, name: String(b.name), enabled: this.sendingPolls === 0, pollsUntilEnabled: this.sendingPolls };
        zone.sending.push(e);
        return ok(view(e));
      }
      const e = zone.sending.find((x) => rest === `/${x.id}`);
      if (e && method === "GET") {
        if (!e.enabled && --e.pollsUntilEnabled <= 0) e.enabled = true;
        return ok(view(e));
      }
      return err(404, 1002, "not found");
    }
    const view = () => ({ name: zone.name, enabled: zone.routingEnabled, support_subaddress: zone.supportSubaddress, status: zone.routingEnabled ? "misconfigured" : "unconfigured" });
    if (rest === "" && method === "GET") return ok(view());
    if (rest === "" && method === "PATCH") {
      if (typeof b.support_subaddress === "boolean") zone.supportSubaddress = b.support_subaddress;
      return ok(view());
    }
    if (rest === "/dns" && method === "GET") {
      // As live (2026-10-25): with `subdomain`, `result` is `{ errors, records }`, and `records`
      // lists every required record whether it exists or not; `errors` is null once they exist.
      const sub = url.searchParams.get("subdomain") ?? zone.name;
      const records = routingRecordsFor(sub);
      const present = records.every((want) => zone.dnsRecords.some((have) => have.name === want.name && have.type === want.type));
      return ok({ errors: present ? null : records.map((r) => ({ code: r.type === "MX" ? "mx.missing" : "spf.missing", missing: r })), records });
    }
    if (rest === "/dns" && method === "POST") {
      // As live: routing is turned on for the whole zone, with an apex SPF and DKIM TXT but no apex MX.
      const sub = String(b.name ?? zone.name);
      zone.routedSubdomains.add(sub);
      zone.routingPollsLeft = this.routingPolls;
      zone.routingEnabled = true;
      const add = (r: FakeDnsRecord) => {
        if (!zone.dnsRecords.some((x) => x.name === r.name && x.type === r.type && x.content === r.content)) zone.dnsRecords.push(r);
      };
      for (const r of routingRecordsFor(sub)) add({ ...r, content: r.type === "MX" ? r.content.replace(/\.$/, "") : r.content });
      add({ name: zone.name, type: "TXT", content: ROUTING_SPF, ttl: 1 });
      add({ name: `cf2024-1._domainkey.${zone.name}`, type: "TXT", content: '"v=DKIM1; h=sha256; k=rsa; p=FAKE"', ttl: 1 });
      return ok({ name: sub, enabled: true, status: "ready" });
    }
    if (rest === "/rules" && method === "GET") return ok(zone.rules, { result_info: { page: 1, per_page: 50, count: zone.rules.length, total_count: zone.rules.length } });
    if (rest === "/rules" && method === "POST") {
      const rule = { id: `rule${this.nextZoneThing++}`, ...(JSON.parse(JSON.stringify(body)) as Omit<FakeRoutingRule, "id">) };
      zone.rules.push(rule);
      return ok(rule);
    }
    const r = zone.rules.find((x) => rest === `/rules/${x.id}`);
    if (r && method === "PUT") {
      Object.assign(r, JSON.parse(JSON.stringify(body)) as object);
      return ok(r);
    }
    return err(404, 1003, "not found");
  }

  /**
   * The fake SST CLI: reads the generated program's embedded input and applies it, modelling
   * SST 4.17.2's state per stage (root cause 2026-10-23-pass1-sst-target-not-found, Review R4;
   * SST `pkg/project/run.go:98-121, 348-360`):
   * - a stage exists for SST only when `sst-state` holds `app/<app>/<stage>` (`PullState`);
   * - `--target X` is resolved against the components in that state only: absent →
   *   `Target not found: X`, before anything is deployed. A targeted run adds nothing to the
   *   state (the Worker is not deployed even when the program declares it);
   * - an untargeted deploy makes the state equal the program: a Worker in state that the
   *   program leaves out is deleted, with its secrets;
   * - `remove` of a stage without `app/` fails with `Stage not found`; otherwise it deletes only
   *   the components in state (not by name) and leaves `app/` behind (an empty checkpoint);
   * - every deploy or remove, failed or not, writes `update/<app>/<stage>/<id>`, and a stage's
   *   first run writes `passphrase/<app>/<stage>`.
   */
  readonly sst: SstExec = async (args, options) => {
    const [command] = args;
    const stage = args[args.indexOf("--stage") + 1]!;
    this.sstRuns.push(args.join(" "));
    if (command === "install") {
      mkdirSync(join(options.cwd, ".sst", "platform"), { recursive: true });
      return { code: 0, output: "✓ Installed" };
    }
    if (command !== "deploy" && command !== "remove") return { code: 1, output: `unknown command ${command}` };
    const program = readFileSync(join(options.cwd, "sst.config.ts"), "utf8");
    this.programs.push(program);
    const input = JSON.parse(/const input = (\{[\s\S]*?\n\}) as const;/.exec(program)![1]!) as {
      app: string;
      filesBucket: string;
      worker?: { name: string; bindings: { type: string; name: string }[] };
    };
    const stateBucket = this.buckets.get("sst-state");
    if (!stateBucket) return { code: 1, output: "✕  state bucket sst-state not found" };
    const id = `${input.app}/${stage}`;
    stateBucket.add(`passphrase/${id}`);
    stateBucket.add(`update/${id}/${String(this.nextUpdate++)}`);
    const hasState = stateBucket.has(`app/${id}`);
    const components = new Set(hasState ? (this.sstState.get(id) ?? []) : []);
    if (this.failSst.has(command)) return { code: 1, output: `✕ ${command} failed: injected` };
    const workerName = `${input.app}-${stage}`;

    if (command === "deploy") {
      const targets = args.flatMap((a, i) => (a === "--target" ? [args[i + 1]!] : []));
      for (const t of targets) if (!components.has(t)) return { code: 1, output: `SST 4.17.2 ready!\n~  Deploy\n✕  Target not found: ${t}` };
      if (targets.length > 0) {
        // Only the targeted components (and their dependents) are updated; nothing is added.
        if (targets.includes("Files") && !this.buckets.has(input.filesBucket)) this.buckets.set(input.filesBucket, new Set());
        return { code: 0, output: "✓ Complete" };
      }
      if (!this.buckets.has(input.filesBucket)) this.buckets.set(input.filesBucket, new Set());
      const next = new Set(["Files"]);
      if (input.worker) {
        const existing = this.workers.get(input.worker.name);
        // A deploy turns the workers.dev route on (A-04 w05, DEC-0091), keeping secrets (A-03).
        this.workers.set(input.worker.name, { secrets: existing?.secrets ?? new Map(), enabled: true, previews: false, bindings: input.worker.bindings });
        next.add("Worker");
      } else if (components.has("Worker")) {
        this.workers.delete(workerName);
      }
      this.sstState.set(id, next);
      stateBucket.add(`app/${id}`);
      return { code: 0, output: "✓ Complete" };
    }

    if (!hasState) return { code: 1, output: "SST 4.17.2 ready!\n✕  Stage not found" };
    if (components.has("Worker")) {
      this.workers.delete(workerName);
      components.delete("Worker");
    }
    if (components.has("Files")) {
      const files = this.buckets.get(input.filesBucket);
      if (files && files.size > 0) {
        this.sstState.set(id, components);
        return { code: 1, output: "✕ Failed: bucket not empty" };
      }
      this.buckets.delete(input.filesBucket);
      components.delete("Files");
    }
    this.sstState.set(id, components);
    return { code: 0, output: "✓ Removed" };
  };

  /** Stores an object as the sink Worker would (its bytes as text). */
  putObject(bucket: string, key: string, text: string): void {
    if (!this.buckets.has(bucket)) this.buckets.set(bucket, new Set());
    this.buckets.get(bucket)!.add(key);
    this.objectBodies.set(`${bucket}/${key}`, text);
  }

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
