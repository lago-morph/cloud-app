/**
 * The Cloudflare account's Workers plan, which sets the account's D1 database limit (PAR-219:
 * 10 on Workers Free, 50,000 on Workers Paid; DEC-0530, DEC-0546). Read the way the compliance
 * harness reads it: the documented Account Subscriptions list `GET /accounts/<a>/subscriptions`
 * (needs "Billing Read"). An account-scoped subscription with rate plan `workers_paid` whose
 * state is not `Cancelled`, `Failed` or `Expired` means Workers Paid; a successful listing
 * without one means Free. When Cloudflare does not answer with a listing (the token lacks
 * Billing Read, an error), the setting `PROTOTYPE_FRAMEWORK_CLOUDFLARE_PLAN=free|paid` decides;
 * without it the plan is unknown and messages name both limits. Read only when the limit
 * matters (a database creation refused with code 7406), never on an ordinary deploy.
 */
import { CloudflareRequestsStopped, type CloudflareApi } from "./api.js";

export type WorkersPlan = "free" | "paid";

export interface PlanReading {
  /** `undefined`: neither Cloudflare nor the setting said. */
  readonly plan: WorkersPlan | undefined;
  readonly source: "api" | "setting" | "unknown";
}

export type WorkersPlanReader = () => Promise<PlanReading>;

/** The explicit fallback setting. */
export const PLAN_SETTING_ENV = "PROTOTYPE_FRAMEWORK_CLOUDFLARE_PLAN";

/** PAR-219 per plan. */
export const D1_DATABASE_LIMIT: Readonly<Record<WorkersPlan, number>> = Object.freeze({ free: 10, paid: 50_000 });

const WORKERS_PAID_RATE_PLAN = "workers_paid";
const ENDED_STATES = new Set(["Cancelled", "Failed", "Expired"]);

/** The plan a subscriptions listing shows, or undefined when the answer is not a listing. */
export function planFromSubscriptions(result: unknown): WorkersPlan | undefined {
  if (!Array.isArray(result)) return undefined;
  const paid = result.some((s: unknown) => {
    if (typeof s !== "object" || s === null) return false;
    const sub = s as { rate_plan?: { id?: unknown; scope?: unknown }; state?: unknown };
    return sub.rate_plan?.id === WORKERS_PAID_RATE_PLAN && sub.rate_plan.scope !== "zone" && !ENDED_STATES.has(String(sub.state));
  });
  return paid ? "paid" : "free";
}

function setting(env: Readonly<Record<string, string | undefined>>): WorkersPlan | undefined {
  const value = env[PLAN_SETTING_ENV];
  return value === "free" || value === "paid" ? value : undefined;
}

/**
 * A reader of the account's plan: one request, Cloudflare first, then the setting. Throws only a
 * request layer's stop (`CloudflareRequestsStopped`, DEC-0619), which is not "no answer".
 */
export function workersPlanReader(api: CloudflareApi, accountId: string, env: Readonly<Record<string, string | undefined>> = {}): WorkersPlanReader {
  return async () => {
    try {
      const r = await api("GET", `/accounts/${accountId}/subscriptions`);
      const body = r.body as { success?: unknown; result?: unknown } | null;
      const plan = r.status === 200 && body?.success === true ? planFromSubscriptions(body.result) : undefined;
      if (plan !== undefined) return { plan, source: "api" };
    } catch (error) {
      if (error instanceof CloudflareRequestsStopped) throw error;
      // no answer: the setting decides
    }
    const fallback = setting(env);
    return fallback === undefined ? { plan: undefined, source: "unknown" } : { plan: fallback, source: "setting" };
  };
}

/** `PAR-219: <limit> on <plan>` for the database-limit message, or both limits when the plan is not known. */
export function databaseLimitText(reading: PlanReading | undefined): string {
  if (reading?.plan === "paid") return `PAR-219: ${D1_DATABASE_LIMIT.paid.toLocaleString("en-US")} on Workers Paid`;
  if (reading?.plan === "free") return `PAR-219: ${D1_DATABASE_LIMIT.free} on Workers Free`;
  return `PAR-219: ${D1_DATABASE_LIMIT.free} on Workers Free, ${D1_DATABASE_LIMIT.paid.toLocaleString("en-US")} on Workers Paid; the account's plan could not be read (it needs "Billing Read", or set ${PLAN_SETTING_ENV}=free|paid)`;
}
