/**
 * Admin page 1, account setup (v0.2.0 plan §5.2 page 1; D7, D10; DEC-0719). With the person's
 * grant (PAR-447 `setup`), in order:
 * 1. the account's `workers.dev` subdomain and Secrets Store, both made by the bootstrap;
 * 2. the auth app and its D1 database (`auth-app-deploy.ts`), bound to the sign-in client's ID and
 *    secret that the bootstrap stored;
 * 3. v0.1.x's shared resources without anything email-related, through the framework's account
 *    steps (`accountSteps`: log, state and backup buckets, the backup lifecycle, the subdomain, the
 *    signing credential); a foreign bucket stops the run;
 * 4. the signing credential put into Secrets Store by F's `createAccountSigningCredential(…,
 *    { secretsStore: true })` (DEC-0729), falling back to the record when Secrets Store is unavailable;
 * 5. the setup record (`framework/account.json` in `sst-state`) at `ACCOUNT_SETUP_VERSION`, with the
 *    framework version and the completed steps; its other fields, and a newer version, are kept.
 * Each step is idempotent, so the page can be run again. No secret value is shown or logged.
 */
import { ACCOUNT_SETTINGS_KEY } from "../provision/cloudflare/account-settings.js";
import { accountSteps, accountSubdomain, type AccountStepId } from "../provision/cloudflare/account.js";
import { describeFailure } from "../provision/cloudflare/api.js";
import { deployAuthApp } from "../provision/cloudflare/auth-app-deploy.js";
import { STATE_BUCKET } from "../provision/cloudflare/names.js";
import { ACCOUNT_SETUP_VERSION } from "../provision/cloudflare/permissions.js";
import { createAccountSigningCredential } from "../provision/cloudflare/r2-token.js";
import { ensureStore } from "../provision/cloudflare/secrets-store.js";
import type { AdminPage, GrantContext } from "./app.js";
import { esc } from "./html.js";

export interface SetupPageOptions {
  /** The auth app's Worker module, compiled into the admin app (bundle.ts). */
  readonly authAppSource: () => string;
  /** This framework's version, recorded in the setup record. */
  readonly frameworkVersion: string;
}

async function writeRecord(ctx: GrantContext, completed: readonly AccountStepId[], frameworkVersion: string): Promise<number> {
  const path = `/accounts/${ctx.accountId}/r2/buckets/${STATE_BUCKET}/objects/${encodeURIComponent(ACCOUNT_SETTINGS_KEY)}`;
  const got = await ctx.api("GET", path);
  if (got.status !== 404 && (got.status < 200 || got.status >= 300)) throw new Error(`reading the setup record failed: ${describeFailure(got)}`);
  const stored = got.status === 404 || typeof got.body !== "object" || got.body === null || Array.isArray(got.body) ? {} : (got.body as Record<string, unknown>);
  const version = Math.max(ACCOUNT_SETUP_VERSION, typeof stored.setupVersion === "number" ? stored.setupVersion : 0);
  const record = {
    ...stored,
    setupVersion: version,
    frameworkVersion,
    appliedAt: new Date(ctx.now()).toISOString(),
    emailDomain: typeof stored.emailDomain === "string" ? stored.emailDomain : "",
    completedSteps: [...completed],
  };
  const put = await ctx.api("PUT", path, record);
  if (put.status < 200 || put.status >= 300 || (put.body as { success?: unknown } | null)?.success === false) throw new Error(`writing the setup record failed: ${describeFailure(put)}`);
  return version;
}

export function createSetupPage(options: SetupPageOptions): AdminPage {
  async function run(ctx: GrantContext): Promise<string> {
    const a = ctx.accountId;
    const source = options.authAppSource();
    const subdomain = await accountSubdomain(ctx.api, a);
    const storeId = await ensureStore(ctx.api, a);
    const auth = await deployAuthApp(ctx.api, a, { source, storeId, subdomain });
    const lines: string[] = [`The auth app is deployed at ${esc(auth.origin)}${auth.databaseCreated ? ", with its new D1 database" : ""}.`];
    const states = new Map<AccountStepId, "owned" | "absent" | "foreign">();
    const completed: AccountStepId[] = [];
    for (const step of accountSteps()) {
      const state = await step.inspect(ctx.api, a, states);
      states.set(step.id, state);
      if (state === "foreign") throw new Error(`${step.resource} belongs to another account (or cannot be read with this sign-in); nothing more was changed`);
      if (state === "absent") {
        if (step.id === "signing-record") {
          const out = await createAccountSigningCredential(ctx.api, a, { secretsStore: true });
          lines.push(`Created the ${esc(step.resource)}${out.where === "record" ? " (Secrets Store was unavailable, so its record holds it)" : " in Secrets Store"}.`);
          if (out.replaced.length > 0) lines.push("It replaced an older one: redeploy each deployed stage so its file uploads and downloads use the new key.");
        } else {
          await step.create(ctx.api, a, {}, (m) => lines.push(esc(m)));
          lines.push(`Created the ${esc(step.resource)}.`);
        }
      } else {
        lines.push(`The ${esc(step.resource)} was already there.`);
      }
      states.set(step.id, "owned");
      completed.push(step.id);
    }
    const version = await writeRecord(ctx, completed, options.frameworkVersion);
    lines.push(`Recorded account setup version ${String(version)}.`);
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
