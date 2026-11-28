/**
 * The account setup (v0.2.0 plan §5.2 page 1; D7, D10; DEC-0719), shared by the admin app's Account
 * setup page and, since DEC-0798, `cloudflare-setup` with the user's one token. With an API that
 * may do it, in order:
 * 1. **read only:** the account's `workers.dev` subdomain and Secrets Store, both made before it
 *    (by `cloudflare-setup`'s first part; none: it stops, writing nothing), and the state of every
 *    shared resource; a foreign bucket stops the run before any write;
 * 2. the auth app and its D1 database (`auth-app-deploy.ts`), bound to the sign-in client's ID and
 *    secret in Secrets Store (missing: nothing is written);
 * 3. v0.1.x's shared resources without anything email-related, through the framework's account
 *    steps (`accountSteps`: log, state and backup buckets, the backup lifecycle, the subdomain);
 * 4. the signing credential in Secrets Store by F's `createAccountSigningCredential(…,
 *    { secretsStore: true })` (DEC-0729): created when absent, and moved there when it is still
 *    held in the record (0.1.x, or an earlier Secrets Store fallback; D7);
 * 5. the setup record (`framework/account.json` in `sst-state`) at `ACCOUNT_SETUP_VERSION`, with the
 *    framework version and the completed steps; its other fields are kept, `emailDomain` is never
 *    invented, and a record a newer release wrote is left as it is.
 * Each step is idempotent, so it can be run again. No secret value is returned. The lines are plain
 * text; the admin app escapes them.
 */
import { ACCOUNT_SETTINGS_KEY } from "./account-settings.js";
import { accountSteps, accountSubdomain, type AccountStepId } from "./account.js";
import { describeFailure, succeeded, type CloudflareApi } from "./api.js";
import { deployAuthApp } from "./auth-app-deploy.js";
import { STATE_BUCKET } from "./names.js";
import { ACCOUNT_SETUP_VERSION } from "./permissions.js";
import { createAccountSigningCredential, readSigningPlacement } from "./r2-token.js";

/** What must have run first: `cloudflare-setup`, which makes the subdomain, the OAuth clients and Secrets Store. */
export const SETUP_FIRST = "run npm run cloudflare-setup first";

export interface AccountSetupOptions {
  /** The auth app's Worker module. */
  readonly authAppSource: () => string | Promise<string>;
  /** This framework's version, recorded in the setup record. */
  readonly frameworkVersion: string;
  /** Milliseconds since the epoch. */
  readonly now: () => number;
}

export interface AccountSetupResult {
  /** What was done, one plain-text line each; never a secret. */
  readonly lines: readonly string[];
  /** The auth app's origin. */
  readonly authOrigin: string;
}

/** The account's Secrets Store, read only: `cloudflare-setup` made it; none means it did not run. */
async function existingStore(api: CloudflareApi, accountId: string): Promise<string> {
  const r = await api("GET", `/accounts/${accountId}/secrets_store/stores?per_page=50`);
  const list = (r.body as { result?: { id?: unknown }[] } | null)?.result;
  if (!succeeded(r) || !Array.isArray(list)) throw new Error(`listing the account's Secrets Store stores failed: ${describeFailure(r)}`);
  const id = list.find((x) => typeof x.id === "string" && x.id !== "")?.id;
  if (typeof id !== "string") throw new Error(`the account has no Secrets Store yet: ${SETUP_FIRST}`);
  return id;
}

/** The account's workers.dev subdomain, read only; `cloudflare-setup` registered it. */
async function existingSubdomain(api: CloudflareApi, accountId: string): Promise<string> {
  try {
    return await accountSubdomain(api, accountId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("has no")) throw new Error(`the account has no workers.dev subdomain yet: ${SETUP_FIRST}`);
    throw e;
  }
}

/**
 * Writes the setup record; leaves it as it is when a newer release recorded a higher version.
 * `emailDomain` is kept when stored and never invented: C's readers refuse an empty one.
 */
async function writeRecord(api: CloudflareApi, accountId: string, completed: readonly AccountStepId[], options: AccountSetupOptions): Promise<{ version: number; written: boolean }> {
  const path = `/accounts/${accountId}/r2/buckets/${STATE_BUCKET}/objects/${encodeURIComponent(ACCOUNT_SETTINGS_KEY)}`;
  const got = await api("GET", path);
  if (got.status !== 404 && (got.status < 200 || got.status >= 300)) throw new Error(`reading the setup record failed: ${describeFailure(got)}`);
  const stored = got.status === 404 || typeof got.body !== "object" || got.body === null || Array.isArray(got.body) ? {} : (got.body as Record<string, unknown>);
  if (typeof stored.setupVersion === "number" && stored.setupVersion > ACCOUNT_SETUP_VERSION) return { version: stored.setupVersion, written: false };
  const record = { ...stored, setupVersion: ACCOUNT_SETUP_VERSION, frameworkVersion: options.frameworkVersion, appliedAt: new Date(options.now()).toISOString(), completedSteps: [...completed] };
  const put = await api("PUT", path, record);
  if (put.status < 200 || put.status >= 300 || (put.body as { success?: unknown } | null)?.success === false) throw new Error(`writing the setup record failed: ${describeFailure(put)}`);
  return { version: ACCOUNT_SETUP_VERSION, written: true };
}

/** Runs the account setup on `accountId` with `api`; throws, naming the cause, when a step fails. */
export async function runAccountSetup(api: CloudflareApi, accountId: string, options: AccountSetupOptions): Promise<AccountSetupResult> {
  const a = accountId;
  const source = await options.authAppSource();
  // Read only, first: what cloudflare-setup made, and every shared resource's state. A foreign
  // bucket stops the run before anything is written.
  const subdomain = await existingSubdomain(api, a);
  const storeId = await existingStore(api, a);
  const steps = accountSteps();
  const states = new Map<AccountStepId, "owned" | "absent" | "foreign">();
  for (const step of steps) {
    const state = await step.inspect(api, a, states);
    if (state === "foreign") throw new Error(`${step.resource} belongs to another account (or cannot be read with this sign-in); nothing was changed`);
    states.set(step.id, state);
  }
  const placement = states.get("signing-record") === "owned" ? await readSigningPlacement(api, a) : undefined;

  const auth = await deployAuthApp(api, a, { source, storeId, subdomain });
  const lines: string[] = [`The auth app is deployed at ${auth.origin}${auth.databaseCreated ? ", with its new D1 database" : ""}.`];
  const completed: AccountStepId[] = [];
  for (const step of steps) {
    // The signing credential also moves into Secrets Store when it is still held in the record (0.1.x, or an earlier fallback; D7).
    const move = step.id === "signing-record" && placement?.kind === "worker-secrets";
    if (states.get(step.id) === "absent" || move) {
      if (step.id === "signing-record") {
        const out = await createAccountSigningCredential(api, a, { secretsStore: true });
        lines.push(`${move ? "Moved" : "Created"} the ${step.resource}${out.where === "record" ? " (Secrets Store was unavailable, so its record holds it; run account setup again later)" : " in Secrets Store"}.`);
        if (out.replaced.length > 0) lines.push("It replaced an older one: redeploy each deployed stage so its file uploads and downloads use the new key.");
      } else {
        await step.create(api, a, {}, (m) => lines.push(m));
        lines.push(`Created the ${step.resource}.`);
      }
    } else {
      lines.push(`The ${step.resource} was already there.`);
    }
    completed.push(step.id);
  }
  const record = await writeRecord(api, a, completed, options);
  lines.push(record.written ? `Recorded account setup version ${String(record.version)}.` : `Kept the setup record: a newer framework recorded the newer setup version ${String(record.version)}.`);
  return { lines, authOrigin: auth.origin };
}
