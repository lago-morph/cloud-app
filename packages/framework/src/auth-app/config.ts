/**
 * The auth app's configuration from its Worker env (DEC-0658). The client secret is a Secrets
 * Store binding (`{ get() }`, plan §3) or, as the Secrets Store fallback (§10), a plain Worker
 * secret. `AUTH_APP_ORIGIN` is the auth app's public origin: the callback URL is built from it,
 * never from the request's Host header. Errors name the setting, never its value.
 */
import { CLOUDFLARE_API_BASE, CLOUDFLARE_DISCOVERY_URL } from "./params.js";
import type { AuthAppConfig } from "./sign-in.js";

const fail = (message: string): never => {
  throw new Error(`auth app misconfigured: ${message}`);
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

export async function readConfig(env: Record<string, unknown>): Promise<AuthAppConfig> {
  const clientId = await setting(env, "AUTH_APP_CLIENT_ID");
  const clientSecret = await setting(env, "AUTH_APP_CLIENT_SECRET");
  const accountId = await setting(env, "AUTH_APP_ACCOUNT_ID");
  const origin = await setting(env, "AUTH_APP_ORIGIN");
  if (!URL.canParse(origin)) fail("AUTH_APP_ORIGIN is not an origin");
  const parsed = new URL(origin);
  // https, or http only on localhost (the rule DEC-0657 applies to return URLs): the callback
  // carries the upstream code.
  const local = parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (parsed.origin !== origin || !(parsed.protocol === "https:" || local)) fail("AUTH_APP_ORIGIN is not an origin");
  return {
    clientId,
    clientSecret,
    accountId,
    discoveryUrl: optional(env, "AUTH_APP_DISCOVERY_URL", CLOUDFLARE_DISCOVERY_URL),
    apiBase: optional(env, "AUTH_APP_API_BASE", CLOUDFLARE_API_BASE),
    callbackUrl: `${origin}/callback`,
  };
}
