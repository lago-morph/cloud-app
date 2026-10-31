/**
 * Admin page 1, account setup (v0.2.0 plan §5.2 page 1; D7, D10; DEC-0719). With the person's
 * grant (PAR-447 `setup`), in order:
 * 1. **read only:** the account's `workers.dev` subdomain and Secrets Store, both made by the
 *    bootstrap (none: the page sends the person to the bootstrap, writing nothing), and the state of
 *    every shared resource; a foreign bucket stops the run before any write;
 * 2. the auth app and its D1 database (`auth-app-deploy.ts`), bound to the sign-in client's ID and
 *    secret that the bootstrap stored (missing: nothing is written);
 * 3. v0.1.x's shared resources without anything email-related, through the framework's account
 *    steps (`accountSteps`: log, state and backup buckets, the backup lifecycle, the subdomain);
 * 4. the signing credential in Secrets Store by F's `createAccountSigningCredential(…,
 *    { secretsStore: true })` (DEC-0729): created when absent, and moved there when it is still
 *    held in the record (0.1.x, or an earlier Secrets Store fallback; D7);
 * 5. the setup record (`framework/account.json` in `sst-state`) at `ACCOUNT_SETUP_VERSION`, with the
 *    framework version and the completed steps; its other fields are kept, `emailDomain` is never
 *    invented, and a record a newer release wrote is left as it is.
 * Each step is idempotent, so the page can be run again. No secret value is shown or logged.
 */
import { ACCOUNT_SETTINGS_KEY } from "../provision/cloudflare/account-settings.js";
import { accountSteps, accountSubdomain, type AccountStepId } from "../provision/cloudflare/account.js";
import { describeFailure, succeeded } from "../provision/cloudflare/api.js";
import { deployAuthApp } from "../provision/cloudflare/auth-app-deploy.js";
import { STATE_BUCKET } from "../provision/cloudflare/names.js";
import { ACCOUNT_SETUP_VERSION } from "../provision/cloudflare/permissions.js";
import { createAccountSigningCredential, readSigningPlacement } from "../provision/cloudflare/r2-token.js";
import type { AdminPage, GrantContext } from "./app.js";
import { esc } from "./html.js";

export interface SetupPageOptions {
  /** The auth app's Worker module, compiled into the admin app (bundle.ts). */
  readonly authAppSource: () => string;
  /** This framework's version, recorded in the setup record. */
  readonly frameworkVersion: string;
}

/** Where the bootstrap must have run first. */
const BOOTSTRAP_FIRST = "run npm run cloudflare-setup with a bootstrap token first";

/** The account's Secrets Store, read only: the bootstrap made it (plan §5.1); none means it did not run. */
async function bootstrapStore(ctx: GrantContext): Promise<string> {
  const r = await ctx.api("GET", `/accounts/${ctx.accountId}/secrets_store/stores?per_page=50`);
  const list = (r.body as { result?: { id?: unknown }[] } | null)?.result;
  if (!succeeded(r) || !Array.isArray(list)) throw new Error(`listing the account's Secrets Store stores failed: ${describeFailure(r)}`);
  const id = list.find((x) => typeof x.id === "string" && x.id !== "")?.id;
  if (typeof id !== "string") throw new Error(`the account has no Secrets Store yet: ${BOOTSTRAP_FIRST}`);
  return id;
}

/** The account's workers.dev subdomain, read only; the bootstrap registered it. */
async function bootstrapSubdomain(ctx: GrantContext): Promise<string> {
  try {
    return await accountSubdomain(ctx.api, ctx.accountId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("has no")) throw new Error(`the account has no workers.dev subdomain yet: ${BOOTSTRAP_FIRST}`);
    throw e;
  }
}

/**
 * Writes the setup record; leaves it as it is when a newer release recorded a higher version.
 * `emailDomain` is kept when stored and never invented: C's readers refuse an empty one.
 */
async function writeRecord(ctx: GrantContext, completed: readonly AccountStepId[], frameworkVersion: string): Promise<{ version: number; written: boolean }> {
  const path = `/accounts/${ctx.accountId}/r2/buckets/${STATE_BUCKET}/objects/${encodeURIComponent(ACCOUNT_SETTINGS_KEY)}`;
  const got = await ctx.api("GET", path);
  if (got.status !== 404 && (got.status < 200 || got.status >= 300)) throw new Error(`reading the setup record failed: ${describeFailure(got)}`);
  const stored = got.status === 404 || typeof got.body !== "object" || got.body === null || Array.isArray(got.body) ? {} : (got.body as Record<string, unknown>);
  if (typeof stored.setupVersion === "number" && stored.setupVersion > ACCOUNT_SETUP_VERSION) return { version: stored.setupVersion, written: false };
  const record = { ...stored, setupVersion: ACCOUNT_SETUP_VERSION, frameworkVersion, appliedAt: new Date(ctx.now()).toISOString(), completedSteps: [...completed] };
  const put = await ctx.api("PUT", path, record);
  if (put.status < 200 || put.status >= 300 || (put.body as { success?: unknown } | null)?.success === false) throw new Error(`writing the setup record failed: ${describeFailure(put)}`);
  return { version: ACCOUNT_SETUP_VERSION, written: true };
}

export function createSetupPage(options: SetupPageOptions): AdminPage {
  async function run(ctx: GrantContext): Promise<string> {
    const a = ctx.accountId;
    const source = options.authAppSource();
    // Read only, first: what the bootstrap made, and every shared resource's state. A foreign
    // bucket stops the run before anything is written.
    const subdomain = await bootstrapSubdomain(ctx);
    const storeId = await bootstrapStore(ctx);
    const steps = accountSteps();
    const states = new Map<AccountStepId, "owned" | "absent" | "foreign">();
    for (const step of steps) {
      const state = await step.inspect(ctx.api, a, states);
      if (state === "foreign") throw new Error(`${step.resource} belongs to another account (or cannot be read with this sign-in); nothing was changed`);
      states.set(step.id, state);
    }
    const placement = states.get("signing-record") === "owned" ? await readSigningPlacement(ctx.api, a) : undefined;

    const auth = await deployAuthApp(ctx.api, a, { source, storeId, subdomain });
    const lines: string[] = [`The auth app is deployed at ${esc(auth.origin)}${auth.databaseCreated ? ", with its new D1 database" : ""}.`];
    const completed: AccountStepId[] = [];
    for (const step of steps) {
      // The signing credential also moves into Secrets Store when it is still held in the record (0.1.x, or an earlier fallback; D7).
      const move = step.id === "signing-record" && placement?.kind === "worker-secrets";
      if (states.get(step.id) === "absent" || move) {
        if (step.id === "signing-record") {
          const out = await createAccountSigningCredential(ctx.api, a, { secretsStore: true });
          lines.push(`${move ? "Moved" : "Created"} the ${esc(step.resource)}${out.where === "record" ? " (Secrets Store was unavailable, so its record holds it; run account setup again later)" : " in Secrets Store"}.`);
          if (out.replaced.length > 0) lines.push("It replaced an older one: redeploy each deployed stage so its file uploads and downloads use the new key.");
        } else {
          await step.create(ctx.api, a, {}, (m) => lines.push(esc(m)));
          lines.push(`Created the ${esc(step.resource)}.`);
        }
      } else {
        lines.push(`The ${esc(step.resource)} was already there.`);
      }
      completed.push(step.id);
    }
    const record = await writeRecord(ctx, completed, options.frameworkVersion);
    lines.push(record.written ? `Recorded account setup version ${String(record.version)}.` : `Kept the setup record: a newer framework recorded the newer setup version ${String(record.version)}.`);
    return `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul><p>Next: create the everyday token on <a href="/everyday">Everyday token</a>.</p>`;
  }
  return {
    id: "setup",
    title: "Account setup",
    view: () =>
      [
        "<p>Sets up this Cloudflare account for prototype apps. It is safe to run again:</p>",
        "<ul>",
        "<li>deploys the auth app (<code>prototype-auth</code>), which signs people in to every app, with its D1 database;</li>",
        "<li>creates the shared R2 buckets for logs, deploy state and backups;</li>",
        "<li>creates the R2 signing credential and puts it in Secrets Store;</li>",
        "<li>records the setup version.</li>",
        "</ul>",
        "<p>Cloudflare will ask you to approve the permissions this needs. Keep them all ticked.</p>",
      ].join("\n"),
    run,
  };
}
