/**
 * Deploy step 7 on Cloudflare (PROV-REQ-002): `GET /api/__framework/health` on the stage's
 * public origin, then one CORS preflight to the stage's storage from that origin. The preflight
 * itself is FILES' (D-02's health-step helper), passed in as `storagePreflight`.
 *
 * A just-started route answers 404 (`error code: 1042`) for up to ~2 s (DEC-0090), and a secret
 * set just before may take a few seconds to reach requests (DEC-0092), so the check retries
 * once a second until it passes or `timeoutMs` (default 30 s, DEC-0090's bound) has passed, and
 * then reports the last failure. Requests send the framework's own User-Agent (DEC-0089).
 */
import type { HealthOutcome } from "../core/operations.js";

export const HEALTH_PATH = "/api/__framework/health";
export const USER_AGENT = "prototype-framework/0.1.0";

export interface HealthCheckOptions {
  readonly fetch: typeof fetch;
  readonly publicOrigin: string;
  /** One CORS preflight to the stage's storage from `origin` (FILES, D-02). */
  readonly storagePreflight: (origin: string) => Promise<HealthOutcome>;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const RETRY_MS = 1000;

async function healthOnce(options: HealthCheckOptions): Promise<HealthOutcome> {
  let response: Response;
  try {
    response = await options.fetch(`${options.publicOrigin}${HEALTH_PATH}`, { headers: { "user-agent": USER_AGENT } });
  } catch (error) {
    return { ok: false, message: `health check got no response: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (response.status === 204 || response.status === 200) return { ok: true };
  const text = await response.text();
  try {
    const { error } = JSON.parse(text) as { error?: { code?: unknown; message?: unknown; requestId?: unknown } };
    if (error && typeof error.code === "string") {
      return {
        ok: false,
        message: `health check failed: ${String(error.message ?? "")}`,
        status: response.status,
        code: error.code,
        ...(typeof error.requestId === "string" ? { requestId: error.requestId } : {}),
      };
    }
  } catch {
    // not an ErrorResponse
  }
  return { ok: false, message: `health check failed: HTTP ${response.status}: ${text.slice(0, 200)}`, status: response.status };
}

export async function checkStageHealth(options: HealthCheckOptions): Promise<HealthOutcome> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + (options.timeoutMs ?? 30_000);
  for (;;) {
    let outcome = await healthOnce(options);
    if (outcome.ok) outcome = await options.storagePreflight(options.publicOrigin);
    if (outcome.ok || now() >= deadline) return outcome;
    await sleep(RETRY_MS);
  }
}
