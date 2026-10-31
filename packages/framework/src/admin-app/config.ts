/**
 * The admin app's settings from its Worker env (DEC-0711):
 * - `ADMIN_CLIENT_ID`, `ADMIN_CLIENT_SECRET` (PAR-439): the admin client, as Secrets Store bindings
 *   (`{ get() }`) or, as the Secrets Store fallback (plan §10), plain Worker secrets;
 * - `ADMIN_ACCOUNT_ID`, `ADMIN_APP_ORIGIN`: plain-text bindings the bootstrap sets
 *   (admin-app-deploy.ts). The callback URL is built from the origin, never from the Host header;
 * - `ADMIN_DISCOVERY_URL`, `ADMIN_API_BASE`: only tests set them (default: Cloudflare's, PAR-418).
 * Errors name the setting, never its value.
 */
import { CLOUDFLARE_API_BASE, CLOUDFLARE_DISCOVERY_URL } from "../auth-app/params.js";
import type { AdminConfig } from "./grant.js";

const fail = (message: string): never => {
  throw new Error(`admin app misconfigured: ${message}`);
};

async function setting(env: Record<string, unknown>, name: string): Promise<string> {
  let value = env[name];
  if (typeof value === "object" && value !== null && typeof (value as { get?: unknown }).get === "function") {
    try {
      value = await (value as { get(): Promise<unknown> }).get();
    } catch {
      return fail(`${name} could not be read`);
    }
  }
  if (typeof value !== "string" || value === "") return fail(`${name} is not set`);
  return value;
}

const optional = (env: Record<string, unknown>, name: string, fallback: string): string => {
  const v = env[name];
  return typeof v === "string" && v !== "" ? v : fallback;
};

export async function readAdminConfig(env: Record<string, unknown>): Promise<AdminConfig> {
  const clientId = await setting(env, "ADMIN_CLIENT_ID");
  const clientSecret = await setting(env, "ADMIN_CLIENT_SECRET");
  const accountId = await setting(env, "ADMIN_ACCOUNT_ID");
  const origin = await setting(env, "ADMIN_APP_ORIGIN");
  if (!URL.canParse(origin)) fail("ADMIN_APP_ORIGIN is not an origin");
  const parsed = new URL(origin);
  const local = parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (parsed.origin !== origin || !(parsed.protocol === "https:" || local)) fail("ADMIN_APP_ORIGIN is not an origin");
  return {
    clientId,
    clientSecret,
    accountId,
    origin,
    discoveryUrl: optional(env, "ADMIN_DISCOVERY_URL", CLOUDFLARE_DISCOVERY_URL),
    apiBase: optional(env, "ADMIN_API_BASE", CLOUDFLARE_API_BASE),
  };
}
