/**
 * `cloudflare-setup [--email-domain <domain>] [--switch-account]` (CLI-REQ-001; plan-setup-wizard
 * §4.3; DEC-0584): the re-runnable Cloudflare setup (`runCloudflareSetup`). It has no `--target`:
 * it reads `.env.cloudflare` itself, bootstrap token included (DEC-0574's opt-out, DEC-0584), after
 * running the local setup, so it is bound with `lazy`, not `cloud`. The template's npm script
 * `cloudflare-setup` runs it.
 */
import { createCloudflareApi } from "../../provision/cloudflare/api.js";
import { runCloudflareSetup, type CloudflareSetupDeps } from "../../provision/cloudflare/cloudflare-setup.js";
import { parseOptions } from "../args.js";
import type { Command } from "../io.js";
import { refuseUnreachableCloud, type ProcessEnvironment } from "./smoke-cloud.js";

/** PAR-360: how long the network check waits for each host. */
export const NETWORK_CHECK_TIMEOUT_MS = 10_000;

export type CloudflareSetupCommandDeps = Omit<CloudflareSetupDeps, "projectDir">;

export function cloudflareSetupCommand(deps: CloudflareSetupCommandDeps): Command {
  return async (args, io) => {
    const switchAccount = args.includes("--switch-account");
    const options = parseOptions(
      args.filter((a) => a !== "--switch-account"),
      ["email-domain", "switch-account"],
    );
    const emailDomain = options.get("email-domain");
    const refused = refuseUnreachableCloud("cloudflare-setup", deps.env, io);
    if (refused !== undefined) return refused;
    return runCloudflareSetup({ ...deps, projectDir: io.cwd }, { ...(emailDomain === undefined ? {} : { emailDomain }), switchAccount }, io);
  };
}

/** Any HTTPS answer means the host is reachable; a request that gets none rejects. */
export function reachWith(doFetch: typeof fetch = fetch, timeoutMs = NETWORK_CHECK_TIMEOUT_MS): (url: string) => Promise<void> {
  return async (url) => {
    await doFetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  };
}

/** `cloudflare-setup` bound to the real Cloudflare API and network. */
export function cloudflareSetupBinding(env: ProcessEnvironment = process.env): Command {
  return cloudflareSetupCommand({ env, apiFor: (token) => createCloudflareApi({ token }), reach: reachWith() });
}
