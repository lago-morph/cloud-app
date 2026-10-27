/**
 * Exercise 5's follow-up: is the `workers.dev` failure of the network step the sandbox's policy, or
 * the host setup reaches? HEAD requests through the guarded layer (`pass.reach`) to the bare
 * account subdomain (what `cloudflare-setup` reaches) and to an existing stage Worker's host on it.
 * Prints kinds and outcomes only, redacted.
 *
 * Run: `NODE_USE_ENV_PROXY=1 node ai/implementation/spikes/live-wizard/run-live.mjs network-probe.ts`.
 */
import { resultOf } from "../../../../packages/framework/src/provision/cloudflare/api.js";
import { startLivePass } from "./guarded-api.js";

const env = process.env;
const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? "";
const pass = await startLivePass({ accountId, envToken: env.CLOUDFLARE_API_TOKEN ?? "", limits: { perPass: 10 } });
const sub = resultOf<{ subdomain: string }>(await pass.api("GET", `/accounts/${accountId}/workers/subdomain`), "reading the subdomain").subdomain;
const hosts: [string, string][] = [
  ["bare account subdomain (what cloudflare-setup reaches)", `https://${sub}.workers.dev/`],
  ["an existing stage Worker's host (reference-prodcheck)", `https://reference-prodcheck.${sub}.workers.dev/`],
  ["an existing account Worker's host (prototype-mailsink)", `https://prototype-mailsink.${sub}.workers.dev/`],
];
for (const [what, url] of hosts) {
  try {
    await pass.reach(url);
    pass.print(`${what}: reachable`);
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
    pass.print(`${what}: not reachable (${error instanceof Error ? error.message : String(error)}${cause})`);
  }
}
pass.print(`calls: ${String(pass.calls().pass)}`);
