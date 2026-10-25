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
 *   4. Email Routing on `t.<domain>` only, never the apex: `GET /zones/<z>/email/routing/dns
 *      ?subdomain=t.<domain>` lists the MX and SPF records still missing; when any is,
 *      `POST /zones/<z>/email/routing/dns` with `{ "name": "t.<domain>" }` adds and locks them,
 *      and the GET is polled until none is missing.
 *   5. Subaddressing (`support_subaddress`, `GET`/`PATCH /zones/<z>/email/routing`).
 *   6. The routing rule: `sink@t.<domain>` → Worker `prototype-mailsink`. Cloudflare allows
 *      catch-all rules on the apex only, so the sink receives `sink+<tag>@t.<domain>` through
 *      one literal rule and subaddressing (`MAIL_SINK_LOCAL_PART`, `sinkAddress`).
 * - `productionPrerequisites` (deploy step 1, production stages; reads only): the zone, the
 *   DEC-0515 permissions, and the domain's Email Sending entry present and enabled.
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
}

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

/** The zone names a domain may belong to: itself, then each parent with at least two labels. */
export function zoneCandidates(domain: string): string[] {
  const labels = domain.split(".");
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join("."));
  return out;
}

export function createCloudflareEmailSetup(options: EmailSetupOptions): CloudflareEmailSetup {
  const { api, accountId } = options;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.pollTimeoutMs ?? 120_000;
  const intervalMs = options.pollIntervalMs ?? 5_000;
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
      return { problem: `${error instanceof Error ? error.message : String(error)} (the token needs "Zone Read" on the email domain's zone; DEC-0515)` };
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
    const r = await api("GET", `${bucketPath}/lifecycle`);
    const rules = r.status === 404 ? [] : (resultOf<{ rules?: unknown } | null>(r, `reading the ${EMAIL_RESOURCES.lifecycle}`)?.rules ?? []);
    if (isWantedLifecycle(rules)) return;
    // Other rules (R2's default multipart-abort rule) are kept; only the framework's rule is replaced.
    const others = Array.isArray(rules) ? rules.filter((rule: { id?: unknown }) => rule.id !== MAIL_SINK_LIFECYCLE_RULE_ID) : [];
    resultOf(await api("PUT", `${bucketPath}/lifecycle`, { rules: [...others, ...MAIL_SINK_LIFECYCLE.rules] }), `setting the ${EMAIL_RESOURCES.lifecycle}`);
    created.push(EMAIL_RESOURCES.lifecycle);
  }

  // ---- The sink Worker ----
  const scriptPath = `/accounts/${accountId}/workers/scripts/${MAIL_SINK_NAME}`;
  async function ensureWorker(created: string[]): Promise<void> {
    const r = await api("GET", `${scriptPath}/settings`);
    if (r.status !== 404) {
      const settings = resultOf<{ tags?: unknown } | null>(r, `reading the ${EMAIL_RESOURCES.worker}`);
      if (Array.isArray(settings?.tags) && settings.tags.includes(mailSinkTag())) return;
    }
    const form = new FormData();
    form.set("metadata", new Blob([JSON.stringify(mailSinkMetadata())], { type: "application/json" }), "metadata.json");
    form.set(MAIL_SINK_MODULE, new Blob([MAIL_SINK_SOURCE], { type: "application/javascript+module" }), MAIL_SINK_MODULE);
    resultOf(await api("PUT", scriptPath, form), `uploading the ${EMAIL_RESOURCES.worker}`);
    created.push(EMAIL_RESOURCES.worker);
  }

  // ---- Email Routing on t.<domain> ----
  const routingPath = (zone: Zone) => `/zones/${zone.id}/email/routing`;
  async function missingRoutingRecords(zone: Zone, sub: string): Promise<string[]> {
    const r = await api("GET", `${routingPath(zone)}/dns?subdomain=${encodeURIComponent(sub)}`);
    const result = resultOf<unknown>(r, `reading the Email Routing DNS records of ${sub}`);
    // With `subdomain`, the answer is `{ errors: [{ code, missing }], records }` (seen live 2026-10-25).
    const errors = typeof result === "object" && result !== null && !Array.isArray(result) ? (result as { errors?: unknown }).errors : undefined;
    if (!Array.isArray(errors)) throw new Error(`reading the Email Routing DNS records of ${sub}: unexpected answer shape (${describeFailure(r)})`);
    return errors.map((e: { code?: unknown; missing?: { type?: unknown; content?: unknown } }) => `${String(e.code ?? "error")}${e.missing ? ` ${String(e.missing.type ?? "")} ${String(e.missing.content ?? "")}` : ""}`.trim());
  }

  async function ensureRouting(zone: Zone, domain: string, created: string[]): Promise<void> {
    const sub = testMailDomain(domain);
    if ((await missingRoutingRecords(zone, sub)).length === 0) return;
    resultOf(await api("POST", `${routingPath(zone)}/dns`, { name: sub }), `enabling Email Routing on ${sub}`);
    created.push(EMAIL_RESOURCES.routing(domain));
    await poll(`the Email Routing DNS records of ${sub}`, () => missingRoutingRecords(zone, sub), (m) => m.length === 0, (m) => `missing: ${m.join(", ")}`);
  }

  async function ensureSubaddressing(zone: Zone, created: string[]): Promise<void> {
    const settings = resultOf<{ support_subaddress?: unknown }>(await api("GET", routingPath(zone)), `reading the Email Routing settings of zone ${zone.name}`);
    if (settings.support_subaddress === true) return;
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
    if (same.some((rule) => rule.enabled === true && rule.actions?.length === 1 && rule.actions[0]?.type === "worker" && rule.actions[0].value?.length === 1 && rule.actions[0].value[0] === MAIL_SINK_NAME)) return;
    const existing = same.find((rule) => typeof rule.id === "string");
    const r: ApiReply = existing?.id
      ? await api("PUT", `${routingPath(zone)}/rules/${existing.id}`, wanted)
      : await api("POST", `${routingPath(zone)}/rules`, wanted);
    resultOf(r, `${existing ? "updating" : "creating"} the ${EMAIL_RESOURCES.rule(domain)}`);
    created.push(EMAIL_RESOURCES.rule(domain));
  }

  return {
    async setupProblems(emailDomain) {
      const { zone, problem } = await zoneOrProblem(emailDomain);
      if (!zone) return [problem ?? `no zone for ${emailDomain}`];
      return permissionProblems(emailDomain, zone, [...EMAIL_PERMISSIONS, ...MAIL_SINK_PERMISSIONS]);
    },

    async setUp(emailDomain) {
      const zone = await requireZone(emailDomain);
      const created: string[] = [];
      await ensureSending(zone, emailDomain, created);
      await ensureBucket(created);
      await ensureWorker(created);
      await ensureRouting(zone, emailDomain, created);
      await ensureSubaddressing(zone, created);
      await ensureRule(zone, emailDomain, created);
      return created;
    },

    async productionPrerequisites(emailDomain) {
      const { zone, problem } = await zoneOrProblem(emailDomain);
      if (!zone) return [problem ?? `no zone for ${emailDomain}`];
      const missing = await permissionProblems(emailDomain, zone, EMAIL_PERMISSIONS);
      let entry: SendingEntry | undefined;
      try {
        entry = await sendingEntry(zone, emailDomain);
      } catch (error) {
        missing.push(error instanceof Error ? error.message : String(error));
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
