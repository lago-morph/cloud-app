/**
 * Admin page 1, account setup (v0.2.0 plan §5.2 page 1; D7, D10; DEC-0719). Since DEC-0798
 * `cloudflare-setup` runs the same account setup (`account-setup-run.ts`) with the user's token, so
 * this page is optional. With the person's grant (PAR-447 `setup`), in order:
 * the steps that module lists.
 * Each step is idempotent, so the page can be run again. No secret value is shown or logged.
 */
import { runAccountSetup } from "../provision/cloudflare/account-setup-run.js";
import type { AdminPage, GrantContext } from "./app.js";
import { esc } from "./html.js";

export interface SetupPageOptions {
  /** The auth app's Worker module, compiled into the admin app (bundle.ts). */
  readonly authAppSource: () => string;
  /** This framework's version, recorded in the setup record. */
  readonly frameworkVersion: string;
}

export function createSetupPage(options: SetupPageOptions): AdminPage {
  async function run(ctx: GrantContext): Promise<string> {
    // The same account setup `cloudflare-setup` runs with the user's token (DEC-0798).
    const { lines } = await runAccountSetup(ctx.api, ctx.accountId, { authAppSource: options.authAppSource, frameworkVersion: options.frameworkVersion, now: ctx.now });
    return `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p>Next: create the everyday token on <a href="/everyday">Everyday token</a>.</p>`;
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
