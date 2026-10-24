/**
 * Cloudflare credentials and the SST tool environment (PROV §2 "Credentials"; DEC-0083,
 * DEC-0088, DEC-0107). Credentials come from the variables the tools normally use and are
 * checked by name only. In the sandbox `CLOUDFLARE_API_TOKEN` holds a non-secret placeholder
 * that the proxy replaces; on an owner machine it holds the real token. SST additionally needs
 * the account as `CLOUDFLARE_DEFAULT_ACCOUNT_ID` and `NODE_USE_ENV_PROXY=1` (its own Node
 * providers call the API with `fetch`). Wrangler is not used by provisioning.
 */
export type Environment = Readonly<Record<string, string | undefined>>;

export const CREDENTIAL_NAMES = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"] as const;

/** Names of the credential variables that are unset or empty. */
export function missingCredentials(env: Environment): string[] {
  return CREDENTIAL_NAMES.filter((name) => (env[name] ?? "") === "");
}

/** The environment SST runs with: the caller's, plus DEC-0107's SST settings. */
export function sstEnvironment(env: Environment): Record<string, string> {
  const kept = Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined));
  return {
    ...kept,
    CLOUDFLARE_DEFAULT_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID ?? "",
    NODE_USE_ENV_PROXY: "1",
    SST_TELEMETRY_DISABLED: "1",
    CI: "1",
  };
}
