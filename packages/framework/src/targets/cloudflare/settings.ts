/**
 * The stage Worker's settings (cloudflare.md §2 "Worker settings"; config.md §2 "Delivery"),
 * target data for provisioning (D-03 maps them onto the SST Worker; `wranglerWorkerConfig` gives
 * the same settings in Wrangler's form, used to run them under local workerd):
 * - the Worker runs first for `/api` and `/api/*`; other paths are static assets, with fallback
 *   to the entry page (`single-page-application`);
 * - the compatibility date and the flag `nodejs_compat` (CF-REQ-003, DEC-0516);
 * - bindings: D1 `DB`, the stage bucket `FILES`, the shared log bucket `prototype-logs` as `LOGS`;
 *   these carry the database, bucket and log-bucket identifiers to the runtime. Production stages
 *   also bind `EMAIL`, an Email Service (`send_email`) binding whose only allowed sender is
 *   `no-reply@<emailDomain>`; test stages bind no `EMAIL` (MAIL-REQ-002, DEC-0514);
 * - the plain-text variable `FRAMEWORK_PUBLIC_ORIGIN`, the stage's generated public origin, and,
 *   when the account settings record names an email domain, `FRAMEWORK_MAIL_FROM`, the sender
 *   address derived from it (MAIL §2).
 * No variable or binding may be named `SECRET_*`: an upload that declares one replaces the Worker
 * secret of that name (DEC-0087). Secrets are set separately (`setSecret`).
 * Not part of any Worker bundle (the runtime never imports it).
 */
import { FrameworkError } from "../../core/errors.js";
import { COMPATIBILITY_DATE, COMPATIBILITY_FLAGS } from "../../build/build.js";
import { senderAddress } from "../../provision/core/account-settings.js";
import { BINDINGS } from "./bindings.js";

/** The account's shared log bucket on Cloudflare (log.md §2). */
export const CLOUDFLARE_LOG_BUCKET = "prototype-logs";

/** Paths the Worker answers before static assets are consulted. */
export const RUN_WORKER_FIRST = Object.freeze(["/api", "/api/*"] as const);

/** What provisioning knows about one stage when it deploys. */
export interface StageWorkerInput {
  /** The Worker's name; its `workers.dev` address is `<workerName>.<account subdomain>.workers.dev`. */
  readonly workerName: string;
  /** The Worker bundle (`.framework/cloudflare/worker.js`). */
  readonly bundle: string;
  /** The built client (static assets, with the entry page `index.html`). */
  readonly assetsDirectory: string;
  /** The stage's public origin, `https://<host>` (no path, no trailing slash). */
  readonly publicOrigin: string;
  /** The stage's current D1 database. */
  readonly database: { readonly id: string; readonly name: string };
  /** The stage's R2 bucket name. */
  readonly filesBucket: string;
  /** Whether the stage is a test stage (`test-*`, PROV-REQ-005): test stages bind no `EMAIL`. */
  readonly isTestStage: boolean;
  /** The account settings record's email domain (DEC-0514); required for a production stage. */
  readonly emailDomain?: string;
}

export interface CloudflareWorkerSettings {
  readonly name: string;
  readonly main: string;
  readonly compatibilityDate: string;
  readonly compatibilityFlags: readonly string[];
  readonly assets: { readonly directory: string; readonly notFoundHandling: "single-page-application"; readonly runWorkerFirst: readonly string[] };
  readonly d1Databases: readonly { readonly binding: string; readonly databaseId: string; readonly databaseName: string }[];
  readonly r2Buckets: readonly { readonly binding: string; readonly bucketName: string }[];
  /** Email Service bindings (production stages: exactly `EMAIL`, restricted to the stage's sender). */
  readonly sendEmail: readonly { readonly binding: string; readonly allowedSenderAddresses: readonly string[] }[];
  /** Plain-text Worker variables. */
  readonly vars: Readonly<Record<string, string>>;
}

const HTTPS_ORIGIN = /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d+)?$/;

/** Refuses settings that declare a `SECRET_*` variable or binding (`CORE.MISCONFIGURED`). */
export function checkWorkerSettings(settings: CloudflareWorkerSettings): void {
  const names = [
    ...Object.keys(settings.vars),
    ...settings.d1Databases.map((d) => d.binding),
    ...settings.r2Buckets.map((b) => b.binding),
    ...settings.sendEmail.map((e) => e.binding),
  ];
  const reserved = names.filter((name) => name.startsWith("SECRET_"));
  if (reserved.length > 0) {
    throw new FrameworkError(
      "CORE.MISCONFIGURED",
      `the Worker settings declare ${reserved.join(", ")}; the SECRET_ prefix is reserved for Worker secrets, which a declared binding would replace`,
    );
  }
}

export function cloudflareWorkerSettings(input: StageWorkerInput): CloudflareWorkerSettings {
  if (!HTTPS_ORIGIN.test(input.publicOrigin)) {
    throw new FrameworkError("CORE.MISCONFIGURED", `the stage's public origin must be an https origin without a path, got ${JSON.stringify(input.publicOrigin)}`);
  }
  if (!input.isTestStage && input.emailDomain === undefined) {
    throw new FrameworkError(
      "CORE.MISCONFIGURED",
      "a production stage's Worker needs the account's email domain for its EMAIL binding; run setup-account --target cloudflare --email-domain <domain>",
    );
  }
  const sender = input.emailDomain === undefined ? undefined : senderAddress(input.emailDomain);
  const settings: CloudflareWorkerSettings = {
    name: input.workerName,
    main: input.bundle,
    compatibilityDate: COMPATIBILITY_DATE,
    compatibilityFlags: [...COMPATIBILITY_FLAGS],
    assets: { directory: input.assetsDirectory, notFoundHandling: "single-page-application", runWorkerFirst: [...RUN_WORKER_FIRST] },
    d1Databases: [{ binding: BINDINGS.database, databaseId: input.database.id, databaseName: input.database.name }],
    r2Buckets: [
      { binding: BINDINGS.files, bucketName: input.filesBucket },
      { binding: BINDINGS.logs, bucketName: CLOUDFLARE_LOG_BUCKET },
    ],
    sendEmail: input.isTestStage || sender === undefined ? [] : [{ binding: BINDINGS.email, allowedSenderAddresses: [sender] }],
    vars: { [BINDINGS.publicOrigin]: input.publicOrigin, ...(sender === undefined ? {} : { [BINDINGS.mailFrom]: sender }) },
  };
  checkWorkerSettings(settings);
  return settings;
}

/** The settings as a Wrangler configuration object (`wrangler.jsonc` form). */
export function wranglerWorkerConfig(settings: CloudflareWorkerSettings): Record<string, unknown> {
  checkWorkerSettings(settings);
  return {
    name: settings.name,
    main: settings.main,
    compatibility_date: settings.compatibilityDate,
    compatibility_flags: [...settings.compatibilityFlags],
    workers_dev: true,
    assets: { directory: settings.assets.directory, not_found_handling: settings.assets.notFoundHandling, run_worker_first: [...settings.assets.runWorkerFirst] },
    d1_databases: settings.d1Databases.map((d) => ({ binding: d.binding, database_id: d.databaseId, database_name: d.databaseName })),
    r2_buckets: settings.r2Buckets.map((b) => ({ binding: b.binding, bucket_name: b.bucketName })),
    ...(settings.sendEmail.length === 0
      ? {}
      : { send_email: settings.sendEmail.map((e) => ({ name: e.binding, allowed_sender_addresses: [...e.allowedSenderAddresses] })) }),
    vars: { ...settings.vars },
  };
}
