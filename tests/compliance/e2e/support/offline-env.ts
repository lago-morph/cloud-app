/**
 * The environment E2E-001's steps run in: the cloud credentials removed (and, for the steps in
 * the offline namespace, an empty HOME instead of the owner's home directory).
 */
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The directory Playwright reads its browsers from for `env` (playwright-core's registry
 * directory on Linux, the only platform with the offline namespace): PLAYWRIGHT_BROWSERS_PATH,
 * else `$XDG_CACHE_HOME` or `$HOME/.cache`, plus `ms-playwright`.
 */
function browsersPath(env: NodeJS.ProcessEnv): string {
  if (env.PLAYWRIGHT_BROWSERS_PATH !== undefined && env.PLAYWRIGHT_BROWSERS_PATH !== "") return env.PLAYWRIGHT_BROWSERS_PATH;
  const cache = env.XDG_CACHE_HOME !== undefined && env.XDG_CACHE_HOME !== "" ? env.XDG_CACHE_HOME : join(env.HOME ?? homedir(), ".cache");
  return join(cache, "ms-playwright");
}

/**
 * `env` without cloud credentials. With `home`, HOME is that directory, and
 * PLAYWRIGHT_BROWSERS_PATH keeps Playwright on the browsers the real home has (root cause
 * ai/implementation/root-causes/2026-11-28-E2E-001-empty-home-hides-browsers.md).
 */
export function noCredentials(env: NodeJS.ProcessEnv, home: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (/^(CLOUDFLARE_|CF_|AWS_|GOOGLE_|GCLOUD|CLOUDSDK_|AZURE_|SST_)/.test(k)) continue;
    if (/^COMPLIANCE_/.test(k)) continue;
    out[k] = v;
  }
  if (home !== undefined) {
    out.PLAYWRIGHT_BROWSERS_PATH = browsersPath(env);
    out.HOME = home;
  }
  return out;
}
