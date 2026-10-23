/**
 * The stage Worker's secrets and public route on Cloudflare (cloudflare.md "Deploy mechanics"
 * `setSecret`, `stopApp`, `startApp`; SEC-REQ-003; DEC-0078, DEC-0087, DEC-0090).
 *
 * Secrets are Worker secrets named `SECRET_<NAME>` (SEC-REQ-003), written through the script's
 * secrets API, never through SST: an SST upload that declared a binding with a secret's name
 * would replace the secret (DEC-0087). Stopping turns the Worker's `workers.dev` route off,
 * starting turns it on; `previews_enabled: false` is always sent, since a body without it turns
 * preview URLs on (DEC-0090). The call answers with the new state, which is checked.
 */
import { secretLocation } from "../../config/secret-locations.js";
import type { Stage } from "../core/operations.js";
import { describeFailure, resultOf, type CloudflareApi } from "./api.js";
import { workerName } from "./names.js";

const scriptPath = (accountId: string, stage: Stage) => `/accounts/${accountId}/workers/scripts/${workerName(stage)}`;

/** `SECRET_<UPPER_SNAKE>` → the lowerCamelCase logical name; undefined for other bindings. */
export function logicalSecretName(location: string): string | undefined {
  if (!location.startsWith("SECRET_")) return undefined;
  const [first = "", ...rest] = location.slice("SECRET_".length).toLowerCase().split("_");
  return first + rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

export async function setSecret(api: CloudflareApi, accountId: string, stage: Stage, name: string, value: string): Promise<void> {
  const r = await api("PUT", `${scriptPath(accountId, stage)}/secrets`, { name: secretLocation("cloudflare", name), text: value, type: "secret_text" });
  if (r.status === 404) throw new Error(`setting secret ${name} failed: Worker ${workerName(stage)} does not exist yet; run deploy first`);
  resultOf(r, `setting secret ${name} on Worker ${workerName(stage)}`);
}

/** Logical names of the Worker's secrets; null while the Worker does not exist. */
export async function listSetSecrets(api: CloudflareApi, accountId: string, stage: Stage): Promise<ReadonlySet<string> | null> {
  const r = await api("GET", `${scriptPath(accountId, stage)}/secrets`);
  if (r.status === 404) return null;
  const secrets = resultOf<{ name: string }[]>(r, `listing the secrets of Worker ${workerName(stage)}`);
  return new Set(secrets.map((s) => logicalSecretName(s.name)).filter((n): n is string => n !== undefined));
}

/** Turns the stage Worker's `workers.dev` route on (`startApp`) or off (`stopApp`). */
export async function setRoute(api: CloudflareApi, accountId: string, stage: Stage, enabled: boolean): Promise<void> {
  const what = `turning ${enabled ? "on" : "off"} the workers.dev route of Worker ${workerName(stage)}`;
  const r = await api("POST", `${scriptPath(accountId, stage)}/subdomain`, { enabled, previews_enabled: false });
  const result = resultOf<{ enabled?: unknown; previews_enabled?: unknown } | null>(r, what);
  if (result?.enabled !== enabled || result.previews_enabled !== false) {
    throw new Error(`${what}: Cloudflare answered enabled ${String(result?.enabled)}, previews_enabled ${String(result?.previews_enabled)} (${describeFailure(r)})`);
  }
}
