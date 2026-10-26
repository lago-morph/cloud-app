/**
 * The Cloudflare email setup behind `setup-account` and a production stage's deploy preflight
 * (PROV-REQ-002, PROV-REQ-004 amendment; MAIL-REQ-005; cloudflare.md "Deploy mechanics"
 * `setupAccount`; DEC-0514, DEC-0515; implementation item I-F, decision note i-f.md).
 *
 * - `setupProblems` (reads only, before `setup-account` changes anything): the email domain's
 *   zone is on this account and active, and the token carries DEC-0515's email permissions plus
 *   the sink's Workers and R2 permissions; each missing one is named.
 * - `setUp` (each step lists first and changes only what is absent or different, so a second
 *   run sends only reads):
 *   1. Email Sending: `GET /zones/<z>/email/sending/subdomains`; only when no entry is named
 *      `<domain>`, `POST` it; then poll `GET …/subdomains/<id>` until `enabled` is true.
 *   2. The sink bucket `prototype-mailsink` (as the shared buckets, `account.ts`), and its
 *      lifecycle rule (`GET`/`PUT …/r2/buckets/prototype-mailsink/lifecycle`, PAR-241).
 *   3. The sink Worker `prototype-mailsink` (`src/mail/sink-worker.ts`), uploaded with
 *      `PUT …/workers/scripts/prototype-mailsink` only when `GET …/settings` lacks the tag
 *      carrying the source's hash.
 *   4. Email Routing on `t.<domain>`: `GET /zones/<z>/email/routing/dns?subdomain=t.<domain>`
 *      lists every MX and SPF record the subdomain needs, present or not, and
 *      `GET /zones/<z>/dns_records?name=t.<domain>` lists those that exist. Only when one is
 *      absent (or Cloudflare reports an error) is `POST /zones/<z>/email/routing/dns`
 *      `{ "name": "t.<domain>" }` sent; then both GETs are polled until none is. That POST also
 *      turns on routing for the whole zone (apex SPF and DKIM, but no apex MX; DEC-0527, i-f.md).
 *   5. Subaddressing (`support_subaddress`, `GET`/`PATCH /zones/<z>/email/routing`).
 *   6. The routing rule: `sink@t.<domain>` → Worker `prototype-mailsink`. Cloudflare allows
 *      catch-all rules on the apex only, so the sink receives `sink+<tag>@t.<domain>` through
 *      one literal rule and subaddressing (`MAIL_SINK_LOCAL_PART`, `sinkAddress`). After creating
 *      or changing it, the rule is read back (polled until listed as wanted), then `setUp` waits
 *      `RULE_SETTLE_MS` before it reports success: a send right after the rule was created was
 *      rejected `550 5.1.1 Address does not exist` (`routing_unknown_address`) because the rule
 *      had not spread yet (live, 2026-10-25; decision note i-g.md).
 * - `productionPrerequisites` (deploy step 1, production stages; reads only): the zone and the
 *   domain's Email Sending entry present and enabled. It reads them with the everyday token's
 *   permissions ("Zone Read" on the zone, "Email Sending Read" on the account) and names the one a
 *   refusal shows is missing; it does not read the token's own policies, so deploy needs no
 *   permission on API tokens, and the write permissions of DEC-0515 are `setup-account`'s only
 *   (DEC-0553; live, 2026-10-25: without "Email Sending Read" the sending listing answers 403).
 * - `steps` (DEC-0578): the six parts of `setUp` above as seven email steps of the account setup
 *   (`EMAIL_STEP_IDS`; the sink bucket and its lifecycle rule are two), each with a read-only
 *   `inspect` and its `apply`, which is the part's own list-then-change code; `setUp` applies them
 *   in order. An inspection uses only reads the everyday token can make where the API allows it:
 *   the Email Routing DNS records (`…/dns_records` needs "DNS Read") and the routing settings
 *   (subaddressing) may be refused it, and a refused read (HTTP 401 or 403) reads `unreadable`,
 *   never done or missing (`setup-steps.ts` then takes the setup record's word for it).
 */
import { createHash } from "node:crypto";
import { MAIL_SINK_BINDING, MAIL_SINK_COMPATIBILITY_DATE, MAIL_SINK_MODULE, MAIL_SINK_SOURCE } from "../../mail/sink-worker.js";
import { testMailDomain } from "../core/account-settings.js";
import { createBucket, inspectBucket } from "./account.js";
import { describeFailure, resultOf, type ApiReply, type CloudflareApi } from "./api.js";
import { EMAIL_PERMISSIONS, MAIL_SINK_PERMISSIONS, missingPermissions, permissionProblem, tokenPolicies, type RequiredPermission } from "./email-permissions.js";
import { MAIL_SINK_NAME } from "./names.js";

export interface CloudflareEmailSetup {
  /** `setup-account`, before any change: the missing prerequisites by name (zone, permissions). Reads only. */
  setupProblems(emailDomain: string): Promise<readonly string[]>;
  /** `setup-account`: makes the domain's email setup exist; idempotent. Returns the names of what it created or changed. */
  setUp(emailDomain: string): Promise<readonly string[]>;
  /** Deploy step 1, production stages: the missing email prerequisites by name. Changes nothing. */
  productionPrerequisites(emailDomain: string): Promise<readonly string[]>;
}

/** The email steps of the account setup, in the order `setUp` applies them (DEC-0578). */
export const EMAIL_STEP_IDS = ["email-sending", "mailsink-bucket", "mailsink-lifecycle", "mailsink-worker", "test-mailbox-dns", "subaddressing", "test-mailbox-route"] as const;
export type EmailStepId = (typeof EMAIL_STEP_IDS)[number];

/**
 * What a step's inspection found: `done`; `missing` (absent or different); `foreign` (a resource of
 * that name this account does not own); `unreadable` (the token was refused the read). `detail`
 * says why, for every state but `done`; it never holds a token value or an account ID.
 */
export interface StepInspection {
  readonly state: "done" | "missing" | "foreign" | "unreadable";
  readonly detail?: string;
}

export interface EmailStep {
  readonly id: EmailStepId;
  /** Reads only. */
  inspect(emailDomain: string): Promise<StepInspection>;
  /** Makes the part exist, listing first; returns the names of what it created or changed (empty when it was in place). */
  apply(emailDomain: string): Promise<readonly string[]>;
}

/** The email setup with its steps (`createCloudflareEmailSetup`). */
export interface CloudflareEmailSteps extends CloudflareEmailSetup {
  readonly steps: readonly EmailStep[];
}

/** A read the token was refused (HTTP 401 or 403): an inspection reports it as `unreadable`. */
class RefusedRead extends Error {}

/** The answer's `result`, as `resultOf`; a refusal throws `RefusedRead` with the same message. */
function readResult<T>(r: ApiReply, what: string): T {
  if (r.status === 401 || r.status === 403) throw new RefusedRead(`${what} failed: ${describeFailure(r)}`);
  return resultOf<T>(r, what);
}

/** What a production deploy reads the Email Sending entry with (DEC-0553); "Email Sending Write" also grants it. */
export const DEPLOY_SENDING_PERMISSION = "Email Sending Read";

/** The local part of the sink's routed address (`sink@t.<domain>`); subaddresses `sink+<tag>@…` reach it too. */
export const MAIL_SINK_LOCAL_PART = "sink";

/** The sink's routed address. */
export const sinkRouteAddress = (emailDomain: string): string => `${MAIL_SINK_LOCAL_PART}@${testMailDomain(emailDomain)}`;

/** A fresh test address that reaches the sink: `sink+<tag>@t.<domain>` (`check-login`, owner tasks). */
export function sinkAddress(emailDomain: string, tag: string): string {
  if (!/^[a-z0-9-]{1,40}$/.test(tag)) throw new Error("a sink address tag is 1 to 40 lowercase letters, digits or hyphens");
  return `${MAIL_SINK_LOCAL_PART}+${tag}@${testMailDomain(emailDomain)}`;
}

/** PAR-241 in seconds (1 day). */
export const MAIL_SINK_RETENTION_SECONDS = 86_400;
/** The lifecycle rule's ID on the sink bucket. */
export const MAIL_SINK_LIFECYCLE_RULE_ID = "framework-mailsink-retention";

/** The lifecycle configuration the sink bucket must have: every object deleted after PAR-241. */
export const MAIL_SINK_LIFECYCLE = Object.freeze({
  rules: [
    {
      id: MAIL_SINK_LIFECYCLE_RULE_ID,
      enabled: true,
      conditions: { prefix: "" },
      deleteObjectsTransition: { condition: { type: "Age", maxAge: MAIL_SINK_RETENTION_SECONDS } },
    },
  ],
});

/** The Worker tag that identifies the uploaded sink source (its SHA-256, shortened). */
export const mailSinkTag = (): string => `framework-mailsink-${createHash("sha256").update(`${MAIL_SINK_COMPATIBILITY_DATE}\n${MAIL_SINK_SOURCE}`).digest("hex").slice(0, 16)}`;

/** The upload's metadata part. */
export function mailSinkMetadata(): Record<string, unknown> {
  return {
    main_module: MAIL_SINK_MODULE,
    compatibility_date: MAIL_SINK_COMPATIBILITY_DATE,
    bindings: [{ type: "r2_bucket", name: MAIL_SINK_BINDING, bucket_name: MAIL_SINK_NAME }],
    tags: [mailSinkTag()],
  };
}

/** Resource names as printed to the owner. */
export const EMAIL_RESOURCES = Object.freeze({
  sending: (domain: string) => `Email Sending entry ${domain}`,
  bucket: `R2 bucket ${MAIL_SINK_NAME}`,
  lifecycle: `lifecycle rule of R2 bucket ${MAIL_SINK_NAME} (PAR-241)`,
  worker: `Worker ${MAIL_SINK_NAME}`,
  routing: (domain: string) => `Email Routing on ${testMailDomain(domain)}`,
  subaddress: "Email Routing subaddressing",
  rule: (domain: string) => `routing rule ${sinkRouteAddress(domain)} → Worker ${MAIL_SINK_NAME}`,
});

export interface EmailSetupOptions {
  readonly api: CloudflareApi;
  readonly accountId: string;
  /** How long to poll the sending entry and the routing records; default 120 s. */
  readonly pollTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** How long `setUp` waits after creating or changing the sink rule; default `RULE_SETTLE_MS`. */
  readonly ruleSettleMs?: number;
}

/** The wait after a new or changed sink rule, so a send cannot race the rule's propagation (i-g.md). */
export const RULE_SETTLE_MS = 60_000;

interface Zone {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

interface SendingEntry {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
}

interface RoutingRule {
  readonly id?: string;
  readonly enabled?: boolean;
  readonly matchers?: readonly { readonly type?: string; readonly field?: string; readonly value?: string }[];
  readonly actions?: readonly { readonly type?: string; readonly value?: readonly string[] }[];
}

/** A DNS record as Email Routing's `…/routing/dns` and the zone's `dns_records` list it. */
export interface RoutingDnsRecord {
  readonly name: string;
  readonly type: string;
  readonly content: string;
  readonly priority?: number;
}

function isRoutingDnsRecord(value: unknown): value is RoutingDnsRecord {
  const v = value as { name?: unknown; type?: unknown; content?: unknown } | null;
  return typeof v === "object" && v !== null && typeof v.name === "string" && typeof v.type === "string" && typeof v.content === "string";
}

/** Record content compared loosely: case, surrounding quotes (TXT) and a trailing dot (MX targets) do not count. */
const dnsContent = (content: string): string => content.trim().replace(/^"(.*)"$/s, "$1").replace(/\.$/, "").toLowerCase();

/** Whether an existing zone record satisfies a required one: same name, type and content. MX priority is Cloudflare's choice, so it is not compared. */
export function sameDnsRecord(want: RoutingDnsRecord, have: RoutingDnsRecord): boolean {
  return want.name.toLowerCase() === have.name.toLowerCase() && want.type.toUpperCase() === have.type.toUpperCase() && dnsContent(want.content) === dnsContent(have.content);
}

/** The zone names a domain may belong to: itself, then each parent with at least two labels. */
export function zoneCandidates(domain: string): string[] {
  const labels = domain.split(".");
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join("."));
  return out;
}

export function createCloudflareEmailSetup(options: EmailSetupOptions): CloudflareEmailSteps {
  const { api, accountId } = options;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.pollTimeoutMs ?? 120_000;
  const intervalMs = options.pollIntervalMs ?? 5_000;
  const ruleSettleMs = options.ruleSettleMs ?? RULE_SETTLE_MS;
  const zones = new Map<string, Zone | undefined>();

  async function findZone(domain: string): Promise<Zone | undefined> {
    if (zones.has(domain)) return zones.get(domain);
    let found: Zone | undefined;
    for (const name of zoneCandidates(domain)) {
      const r = await api("GET", `/zones?name=${encodeURIComponent(name)}&account.id=${accountId}`);
      const list = resultOf<Zone[]>(r, `looking up the Cloudflare zone of ${domain}`);
      found = list.find((z) => z.name === name);
      if (found) break;
    }
    zones.set(domain, found);
    return found;
  }

  /** The zone, or the problem that stops everything. */
  async function zoneOrProblem(domain: string): Promise<{ zone?: Zone; problem?: string }> {
    let zone: Zone | undefined;
    try {
      zone = await findZone(domain);
    } catch (error) {
      return { problem: `${error instanceof Error ? error.message : String(error)} (the token needs "Zone Read" on the email domain's zone; DEC-0515, DEC-0553)` };
    }
    if (!zone) return { problem: `the email domain ${domain} is not in a zone of this Cloudflare account; add the domain to Cloudflare DNS first` };
    if (zone.status !== "active") return { problem: `the zone ${zone.name} of the email domain is ${zone.status}, not active; finish adding it to Cloudflare DNS first` };
    return { zone };
  }

  async function permissionProblems(domain: string, zone: Zone, required: readonly RequiredPermission[]): Promise<string[]> {
    let policies;
    try {
      policies = await tokenPolicies(api, accountId);
    } catch (error) {
      return [error instanceof Error ? error.message : String(error)];
    }
    return missingPermissions(policies, required, accountId, zone.id).map((p) => permissionProblem(p, domain));
  }

  async function requireZone(domain: string): Promise<Zone> {
    const { zone, problem } = await zoneOrProblem(domain);
    if (!zone) throw new Error(problem ?? `no zone for ${domain}`);
    return zone;
  }

  async function poll<T>(what: string, read: () => Promise<T>, done: (value: T) => boolean, describe: (value: T) => string): Promise<T> {
    const deadline = now() + timeoutMs;
    for (;;) {
      const value = await read();
      if (done(value)) return value;
      if (now() >= deadline) throw new Error(`${what}: still ${describe(value)} after ${Math.round(timeoutMs / 1000)} s; run setup-account again later`);
      await sleep(intervalMs);
    }
  }

  // ---- Email Sending ----
  const sendingPath = (zone: Zone) => `/zones/${zone.id}/email/sending/subdomains`;
  async function sendingEntry(zone: Zone, domain: string): Promise<SendingEntry | undefined> {
    const list = resultOf<SendingEntry[]>(await api("GET", sendingPath(zone)), `listing the Email Sending domains of zone ${zone.name}`);
    return list.find((e) => e.name === domain);
  }

  async function ensureSending(zone: Zone, domain: string, created: string[]): Promise<void> {
    let entry = await sendingEntry(zone, domain);
    if (!entry) {
      entry = resultOf<SendingEntry>(await api("POST", sendingPath(zone), { name: domain }), `onboarding ${domain} for Email Sending`);
      created.push(EMAIL_RESOURCES.sending(domain));
    }
    if (entry.enabled === true) return;
    const id = entry.id;
    await poll(
      `the ${EMAIL_RESOURCES.sending(domain)}`,
      async () => resultOf<SendingEntry>(await api("GET", `${sendingPath(zone)}/${id}`), `reading the ${EMAIL_RESOURCES.sending(domain)}`),
      (e) => e.enabled === true,
      () => "not enabled (not verified)",
    );
  }

  // ---- The sink bucket and its lifecycle ----
  const bucketPath = `/accounts/${accountId}/r2/buckets/${MAIL_SINK_NAME}`;
  async function ensureBucket(created: string[]): Promise<void> {
    const state = await inspectBucket(api, accountId, MAIL_SINK_NAME);
    if (state.state === "foreign") throw new Error(`${EMAIL_RESOURCES.bucket} already exists but belongs to another account (or this account's credentials cannot read it); nothing of the mail sink was created`);
    if (state.state === "absent") {
      await createBucket(api, accountId, MAIL_SINK_NAME);
      created.push(EMAIL_RESOURCES.bucket);
    }
  }

  async function lifecycleRules(): Promise<unknown> {
    const r = await api("GET", `${bucketPath}/lifecycle`);
    return r.status === 404 ? [] : (resultOf<{ rules?: unknown } | null>(r, `reading the ${EMAIL_RESOURCES.lifecycle}`)?.rules ?? []);
  }

  async function ensureLifecycle(created: string[]): Promise<void> {
    const rules = await lifecycleRules();
    if (isWantedLifecycle(rules)) return;
    // Other rules (R2's default multipart-abort rule) are kept; only the framework's rule is replaced.
    const others = Array.isArray(rules) ? rules.filter((rule: { id?: unknown }) => rule.id !== MAIL_SINK_LIFECYCLE_RULE_ID) : [];
    resultOf(await api("PUT", `${bucketPath}/lifecycle`, { rules: [...others, ...MAIL_SINK_LIFECYCLE.rules] }), `setting the ${EMAIL_RESOURCES.lifecycle}`);
    created.push(EMAIL_RESOURCES.lifecycle);
  }

  // ---- The sink Worker ----
  const scriptPath = `/accounts/${accountId}/workers/scripts/${MAIL_SINK_NAME}`;
  /** Whether the uploaded sink carries the current source's tag (false when there is no sink Worker). */
  async function workerCurrent(): Promise<boolean> {
    const r = await api("GET", `${scriptPath}/settings`);
    if (r.status === 404) return false;
    const settings = resultOf<{ tags?: unknown } | null>(r, `reading the ${EMAIL_RESOURCES.worker}`);
    return Array.isArray(settings?.tags) && settings.tags.includes(mailSinkTag());
  }

  async function ensureWorker(created: string[]): Promise<void> {
    if (await workerCurrent()) return;
    const form = new FormData();
    form.set("metadata", new Blob([JSON.stringify(mailSinkMetadata())], { type: "application/json" }), "metadata.json");
    form.set(MAIL_SINK_MODULE, new Blob([MAIL_SINK_SOURCE], { type: "application/javascript+module" }), MAIL_SINK_MODULE);
    resultOf(await api("PUT", scriptPath, form), `uploading the ${EMAIL_RESOURCES.worker}`);
    created.push(EMAIL_RESOURCES.worker);
  }

  // ---- Email Routing on t.<domain> ----
  const routingPath = (zone: Zone) => `/zones/${zone.id}/email/routing`;
  /**
   * The records Cloudflare requires for `sub`, and the errors it reports. The API reference
   * ("Email Routing DNS settings: Get", i-f.md) documents `result` as the list of DNS records
   * "needed to configure your Email Routing zone". With the deprecated `subdomain` parameter
   * the live answer is `{ errors, records }` instead (2026-10-25), and `records` lists every
   * required record whether it exists or not. Both shapes are accepted.
   */
  async function requiredRoutingRecords(zone: Zone, sub: string): Promise<{ records: RoutingDnsRecord[]; errors: string[] }> {
    const r = await api("GET", `${routingPath(zone)}/dns?subdomain=${encodeURIComponent(sub)}`);
    const what = `reading the Email Routing DNS records of ${sub}`;
    const result = readResult<unknown>(r, what);
    const shapeError = () => new Error(`${what}: unexpected answer shape (${describeFailure(r)})`);
    let records: unknown;
    let errors: unknown = null;
    if (Array.isArray(result)) records = result;
    else if (typeof result === "object" && result !== null) ({ records, errors = null } = result as { records?: unknown; errors?: unknown });
    else throw shapeError();
    if (!Array.isArray(records) || records.length === 0 || !records.every(isRoutingDnsRecord)) throw shapeError();
    if (errors !== null && !Array.isArray(errors)) throw shapeError();
    const reported = ((errors as { code?: unknown; missing?: { type?: unknown; content?: unknown } }[] | null) ?? []).map(
      (e) => `${String(e.code ?? "error")}${e.missing ? ` ${String(e.missing.type ?? "")} ${String(e.missing.content ?? "")}` : ""}`.trim(),
    );
    return { records, errors: reported };
  }

  /** The zone's DNS records named `name` (`GET /zones/<z>/dns_records?name=<name>`, an exact match). */
  async function zoneDnsRecords(zone: Zone, name: string): Promise<RoutingDnsRecord[]> {
    const out: RoutingDnsRecord[] = [];
    for (let page = 1; page <= 10; page++) {
      const r = await api("GET", `/zones/${zone.id}/dns_records?name=${encodeURIComponent(name)}&per_page=100&page=${page}`);
      const batch = readResult<unknown>(r, `listing the DNS records of ${name}`);
      if (!Array.isArray(batch)) throw new Error(`listing the DNS records of ${name}: unexpected answer shape (${describeFailure(r)})`);
      out.push(...batch.filter(isRoutingDnsRecord));
      const pages = (r.body as { result_info?: { total_pages?: unknown } }).result_info?.total_pages;
      if (batch.length < 100 || typeof pages !== "number" || page >= pages) return out;
    }
    throw new Error(`listing the DNS records of ${name}: more than 10 pages`);
  }

  /** What still stops routing on `sub`: required records absent from the zone's DNS, and the errors Cloudflare reports. Empty when ready. */
  async function routingGaps(zone: Zone, sub: string): Promise<string[]> {
    const { records, errors } = await requiredRoutingRecords(zone, sub);
    const existing = await zoneDnsRecords(zone, sub);
    const missing = records.filter((want) => !existing.some((have) => sameDnsRecord(want, have))).map((want) => `${want.type} ${want.content}`);
    return [...new Set([...missing, ...errors])];
  }

  async function ensureRouting(zone: Zone, domain: string, created: string[]): Promise<void> {
    const sub = testMailDomain(domain);
    if ((await routingGaps(zone, sub)).length === 0) return;
    // Known Cloudflare behaviour (seen live 2026-10-25; DEC-0527, i-f.md): this POST also turns
    // on Email Routing for the whole zone and adds an apex SPF TXT and a DKIM TXT. The apex gets
    // no MX, so the zone reads `status: "misconfigured"` and the apex receives nothing.
    resultOf(await api("POST", `${routingPath(zone)}/dns`, { name: sub }), `enabling Email Routing on ${sub}`);
    created.push(EMAIL_RESOURCES.routing(domain));
    await poll(`the Email Routing DNS records of ${sub}`, () => routingGaps(zone, sub), (m) => m.length === 0, (m) => `missing: ${m.join(", ")}`);
  }

  async function subaddressingOn(zone: Zone): Promise<boolean> {
    const settings = readResult<{ support_subaddress?: unknown }>(await api("GET", routingPath(zone)), `reading the Email Routing settings of zone ${zone.name}`);
    return settings.support_subaddress === true;
  }

  async function ensureSubaddressing(zone: Zone, created: string[]): Promise<void> {
    if (await subaddressingOn(zone)) return;
    resultOf(await api("PATCH", routingPath(zone), { support_subaddress: true }), `turning on Email Routing subaddressing on zone ${zone.name}`);
    created.push(EMAIL_RESOURCES.subaddress);
  }

  async function routingRules(zone: Zone): Promise<RoutingRule[]> {
    const rules: RoutingRule[] = [];
    for (let page = 1; page <= 20; page++) {
      const r = await api("GET", `${routingPath(zone)}/rules?per_page=50&page=${page}`);
      const batch = resultOf<RoutingRule[]>(r, `listing the Email Routing rules of zone ${zone.name}`);
      rules.push(...batch);
      const info = (r.body as { result_info?: { total_count?: unknown } }).result_info;
      if (batch.length < 50 || (typeof info?.total_count === "number" && rules.length >= info.total_count)) return rules;
    }
    throw new Error(`listing the Email Routing rules of zone ${zone.name}: more than 20 pages`);
  }

  const isSinkRule = (rule: RoutingRule, address: string): boolean =>
    rule.enabled === true &&
    rule.matchers?.length === 1 &&
    rule.matchers[0]?.type === "literal" &&
    rule.matchers[0].value?.toLowerCase() === address &&
    rule.actions?.length === 1 &&
    rule.actions[0]?.type === "worker" &&
    rule.actions[0].value?.length === 1 &&
    rule.actions[0].value[0] === MAIL_SINK_NAME;

  async function ensureRule(zone: Zone, domain: string, created: string[]): Promise<void> {
    const address = sinkRouteAddress(domain);
    const wanted = {
      name: `framework mail sink (${MAIL_SINK_NAME})`,
      enabled: true,
      matchers: [{ type: "literal", field: "to", value: address }],
      actions: [{ type: "worker", value: [MAIL_SINK_NAME] }],
    };
    const rules = await routingRules(zone);
    const same = rules.filter((rule) => rule.matchers?.length === 1 && rule.matchers[0]?.type === "literal" && rule.matchers[0].value?.toLowerCase() === address);
    if (same.some((rule) => isSinkRule(rule, address))) return;
    const existing = same.find((rule) => typeof rule.id === "string");
    const r: ApiReply = existing?.id
      ? await api("PUT", `${routingPath(zone)}/rules/${existing.id}`, wanted)
      : await api("POST", `${routingPath(zone)}/rules`, wanted);
    resultOf(r, `${existing ? "updating" : "creating"} the ${EMAIL_RESOURCES.rule(domain)}`);
    // Read it back, then let it spread before anything is sent to it.
    await poll(
      `reading back the ${EMAIL_RESOURCES.rule(domain)}`,
      () => routingRules(zone),
      (list) => list.some((rule) => isSinkRule(rule, address)),
      () => "not listed as an enabled rule to the Worker",
    );
    await sleep(ruleSettleMs);
    created.push(EMAIL_RESOURCES.rule(domain));
  }

  const hasSinkRule = async (zone: Zone, domain: string): Promise<boolean> => (await routingRules(zone)).some((rule) => isSinkRule(rule, sinkRouteAddress(domain)));

  // ---- The steps (DEC-0578) ----
  const done: StepInspection = { state: "done" };
  const missing = (detail: string): StepInspection => ({ state: "missing", detail });
  /** An inspection of a part on the domain's zone: missing, naming the problem, when there is no usable zone. */
  const onZone =
    (inspect: (zone: Zone, domain: string) => Promise<StepInspection>) =>
    async (domain: string): Promise<StepInspection> => {
      const { zone, problem } = await zoneOrProblem(domain);
      return zone ? inspect(zone, domain) : missing(problem ?? `no zone for ${domain}`);
    };
  /** A refused read (HTTP 401/403) is `unreadable`, never a guess. */
  const refusedIsUnreadable =
    (inspect: (domain: string) => Promise<StepInspection>) =>
    async (domain: string): Promise<StepInspection> => {
      try {
        return await inspect(domain);
      } catch (error) {
        if (error instanceof RefusedRead) return { state: "unreadable", detail: error.message };
        throw error;
      }
    };
  /** An apply: the part's list-then-change code on a fresh `created` list. */
  const applying =
    (ensure: (domain: string, created: string[]) => Promise<void>) =>
    async (domain: string): Promise<readonly string[]> => {
      const created: string[] = [];
      await ensure(domain, created);
      return created;
    };

  const steps: readonly EmailStep[] = [
    {
      id: "email-sending",
      inspect: onZone(async (zone, domain) => {
        const entry = await sendingEntry(zone, domain);
        if (!entry) return missing(`${domain} is not onboarded for Email Sending`);
        return entry.enabled === true ? done : missing(`the ${EMAIL_RESOURCES.sending(domain)} is not verified yet`);
      }),
      apply: applying(async (domain, created) => ensureSending(await requireZone(domain), domain, created)),
    },
    {
      id: "mailsink-bucket",
      async inspect() {
        const { state } = await inspectBucket(api, accountId, MAIL_SINK_NAME);
        if (state === "foreign") return { state, detail: `${EMAIL_RESOURCES.bucket} already exists but belongs to another account (or this account's credentials cannot read it)` };
        return state === "owned" ? done : missing(`${EMAIL_RESOURCES.bucket} does not exist`);
      },
      apply: applying(async (_domain, created) => ensureBucket(created)),
    },
    {
      id: "mailsink-lifecycle",
      inspect: async () => ((await inspectBucket(api, accountId, MAIL_SINK_NAME)).state === "owned" && isWantedLifecycle(await lifecycleRules()) ? done : missing(`the ${EMAIL_RESOURCES.lifecycle} is not set`)),
      apply: applying(async (_domain, created) => ensureLifecycle(created)),
    },
    {
      id: "mailsink-worker",
      inspect: async () => ((await workerCurrent()) ? done : missing(`the ${EMAIL_RESOURCES.worker} is absent or runs an older source`)),
      apply: applying(async (_domain, created) => ensureWorker(created)),
    },
    {
      id: "test-mailbox-dns",
      inspect: refusedIsUnreadable(
        onZone(async (zone, domain) => {
          const gaps = await routingGaps(zone, testMailDomain(domain));
          return gaps.length === 0 ? done : missing(`the ${EMAIL_RESOURCES.routing(domain)} lacks ${gaps.join(", ")}`);
        }),
      ),
      apply: applying(async (domain, created) => ensureRouting(await requireZone(domain), domain, created)),
    },
    {
      id: "subaddressing",
      inspect: refusedIsUnreadable(onZone(async (zone) => ((await subaddressingOn(zone)) ? done : missing(`${EMAIL_RESOURCES.subaddress} is off on zone ${zone.name}`)))),
      apply: applying(async (domain, created) => ensureSubaddressing(await requireZone(domain), created)),
    },
    {
      id: "test-mailbox-route",
      inspect: onZone(async (zone, domain) => ((await hasSinkRule(zone, domain)) ? done : missing(`the ${EMAIL_RESOURCES.rule(domain)} is not an enabled rule`))),
      apply: applying(async (domain, created) => ensureRule(await requireZone(domain), domain, created)),
    },
  ];

  return {
    steps,

    async setupProblems(emailDomain) {
      const { zone, problem } = await zoneOrProblem(emailDomain);
      if (!zone) return [problem ?? `no zone for ${emailDomain}`];
      return permissionProblems(emailDomain, zone, [...EMAIL_PERMISSIONS, ...MAIL_SINK_PERMISSIONS]);
    },

    async setUp(emailDomain) {
      const created: string[] = [];
      for (const step of steps) created.push(...(await step.apply(emailDomain)));
      return created;
    },

    async productionPrerequisites(emailDomain) {
      const { zone, problem } = await zoneOrProblem(emailDomain);
      if (!zone) return [problem ?? `no zone for ${emailDomain}`];
      const missing: string[] = [];
      let entry: SendingEntry | undefined;
      try {
        entry = await sendingEntry(zone, emailDomain);
      } catch (error) {
        missing.push(`${error instanceof Error ? error.message : String(error)} (the token needs "${DEPLOY_SENDING_PERMISSION}" on the account; DEC-0553)`);
        return missing;
      }
      if (!entry) missing.push(`${emailDomain} is not onboarded for Email Sending; run setup-account --target cloudflare`);
      else if (entry.enabled !== true) missing.push(`the ${EMAIL_RESOURCES.sending(emailDomain)} is not verified yet; run setup-account --target cloudflare again`);
      return missing;
    },
  };
}

/** Whether the bucket's lifecycle rules already contain the framework's PAR-241 rule, unchanged. */
export function isWantedLifecycle(rules: unknown): boolean {
  if (!Array.isArray(rules)) return false;
  const want = MAIL_SINK_LIFECYCLE.rules[0]!;
  return rules.some((rule: { id?: unknown; enabled?: unknown; conditions?: { prefix?: unknown }; deleteObjectsTransition?: { condition?: { type?: unknown; maxAge?: unknown } } }) =>
    rule.id === want.id &&
    rule.enabled === true &&
    (rule.conditions?.prefix ?? "") === "" &&
    rule.deleteObjectsTransition?.condition?.type === "Age" &&
    rule.deleteObjectsTransition.condition.maxAge === want.deleteObjectsTransition.condition.maxAge,
  );
}

/** Kept for tests and offline tools: an email setup that calls nothing and reports nothing missing. */
export const pendingEmailSetup: CloudflareEmailSetup = Object.freeze({
  setupProblems: async () => [],
  setUp: async () => [],
  productionPrerequisites: async () => [],
});
