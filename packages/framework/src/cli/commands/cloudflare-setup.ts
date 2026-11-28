/**
 * `cloudflare-setup` (CLI-REQ-001; plan-setup-wizard §4.3; DEC-0584): the re-runnable Cloudflare
 * setup (`runCloudflareSetup`). It takes no options: since DEC-0799 there is no `--switch-account`
 * (the account is the user's `CLOUDFLARE_ACCOUNT_ID`, which setup never writes). It has no
 * `--target`: it reads the credential itself (DEC-0795) after running the local setup, so it is
 * bound with `lazy`, not `cloud`. The template's npm script `cloudflare-setup` runs it.
 */
import { createCloudflareApi } from "../../provision/cloudflare/api.js";
import { runCloudflareSetup, type CloudflareSetupDeps } from "../../provision/cloudflare/cloudflare-setup.js";
import { UsageError } from "../args.js";
import type { Command } from "../io.js";
import { cloudProcessProblems, type ProcessEnvironment } from "./smoke-cloud.js";

/** PAR-360: how long the network check waits for each host. */
export const NETWORK_CHECK_TIMEOUT_MS = 10_000;

export type CloudflareSetupCommandDeps = Omit<CloudflareSetupDeps, "projectDir">;

export function cloudflareSetupCommand(deps: CloudflareSetupCommandDeps): Command {
  return async (args, io) => {
    // The arguments are never echoed: one may be a pasted token.
    if (args.length > 0) throw new UsageError("cloudflare-setup takes no arguments (--switch-account is gone: set CLOUDFLARE_ACCOUNT_ID to the account to use)");
    // The process check (D-05) stops the run only before its first request, so the local setup and the no-credential instructions still run.
    const problems = cloudProcessProblems(deps.env);
    const unreachable = problems.length === 0 ? {} : { unreachable: problems.join("; ") };
    return runCloudflareSetup({ ...deps, ...unreachable, projectDir: io.cwd }, io);
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
