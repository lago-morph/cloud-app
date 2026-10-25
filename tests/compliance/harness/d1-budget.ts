/**
 * Cloudflare D1 budgets of compliance runs, by the account's Workers plan (plan §1 "Cloud usage
 * limits"; DEC-0419 for the Free plan, DEC-0530 for both plans; PAR-284, PAR-285).
 *
 * Owner (2026-10-25): "you need to use different D1 limits for free and paid accounts. Still no
 * limit testing though." Each budget sits well inside the plan's included usage
 * (developers.cloudflare.com/d1/platform/pricing/, /d1/platform/limits/, read 2026-10-25):
 * - **Free:** 5,000,000 rows read and 100,000 rows written per day (reset 00:00 UTC), 10
 *   databases per account. Budget (DEC-0419, unchanged): per pass ≤ 10,000 written and ≤ 500,000
 *   read; per UTC day ≤ 50,000 written and ≤ 2,500,000 read (half the daily limits); ≤ 8
 *   databases at once.
 * - **Workers Paid:** 25 billion rows read and 50 million rows written included per month (then
 *   billed), 50,000 databases per account. Budget: per pass ≤ 100,000 written and ≤ 5,000,000
 *   read; per UTC day ≤ 500,000 written and ≤ 25,000,000 read, so even 31 days at the daily cap
 *   stay within 31 % of the written and 3.1 % of the read rows included per month: tests never
 *   cause a charge; ≤ 20 databases at once.
 * The binding protection on both plans is unchanged: no stress tests, load tests, platform-limit
 * probing or row loops; tens of rows per test.
 *
 * The plan (DEC-0530): read from the documented `GET /accounts/<account>/subscriptions`
 * (Account Subscriptions: List, needs "Billing Read"): an account-scoped subscription with rate
 * plan `workers_paid` that is not cancelled, failed or expired means Workers Paid; a successful
 * listing without one means Free. When Cloudflare does not answer (no Billing Read, an error),
 * the explicit setting `COMPLIANCE_CLOUDFLARE_PLAN=free|paid` decides; without it, Free. The
 * driver reads the plan once per cloud run and hands it to the test processes in
 * `COMPLIANCE_D1_PLAN`, so the tests make no extra request.
 */

export type D1Plan = "free" | "paid";

export interface RowBudget {
  readonly rowsWritten: number;
  readonly rowsRead: number;
}

export interface D1Budget {
  readonly plan: D1Plan;
  readonly perPass: RowBudget;
  /** Per UTC day, for the whole run and every other cloud item that day. */
  readonly perDay: RowBudget;
  /** Test-stage D1 databases at once. */
  readonly maxDatabases: number;
  /** The parameter the values are recorded in. */
  readonly parameter: string;
}

export const D1_BUDGETS: Readonly<Record<D1Plan, D1Budget>> = Object.freeze({
  free: Object.freeze({ plan: "free", perPass: { rowsWritten: 10_000, rowsRead: 500_000 }, perDay: { rowsWritten: 50_000, rowsRead: 2_500_000 }, maxDatabases: 8, parameter: "PAR-284" }),
  paid: Object.freeze({ plan: "paid", perPass: { rowsWritten: 100_000, rowsRead: 5_000_000 }, perDay: { rowsWritten: 500_000, rowsRead: 25_000_000 }, maxDatabases: 20, parameter: "PAR-285" }),
});

/** The operator's explicit setting, used when Cloudflare does not tell the plan. */
export const PLAN_SETTING_ENV = "COMPLIANCE_CLOUDFLARE_PLAN";
/** The plan the driver read for this run, passed to the test processes. */
export const RUN_PLAN_ENV = "COMPLIANCE_D1_PLAN";

/** Cloudflare's rate plan ID of the Workers Paid subscription (seen live on 2026-10-25). */
export const WORKERS_PAID_RATE_PLAN = "workers_paid";
const ENDED_STATES = new Set(["Cancelled", "Failed", "Expired"]);

type Env = Readonly<Record<string, string | undefined>>;

/** One Cloudflare API call as the harness makes it: status and parsed JSON body (undefined when not JSON). */
export type CfCall = (method: string, path: string, body?: unknown) => Promise<{ readonly status: number; readonly body: unknown }>;

export interface PlanReading {
  readonly plan: D1Plan;
  readonly source: "api" | "setting" | "default";
  /** Why: what Cloudflare answered, and the setting when it was used or disagrees. */
  readonly detail: string;
}

function parseSetting(env: Env): D1Plan | undefined {
  const value = env[PLAN_SETTING_ENV];
  if (value === undefined || value === "") return undefined;
  if (value === "free" || value === "paid") return value;
  throw new Error(`${PLAN_SETTING_ENV}=${value} is not one of free, paid`);
}

/** The plan a subscriptions listing shows, or undefined when the answer is not a listing. */
export function planFromSubscriptions(result: unknown): D1Plan | undefined {
  if (!Array.isArray(result)) return undefined;
  const paid = result.some((s: unknown) => {
    if (typeof s !== "object" || s === null) return false;
    const sub = s as { rate_plan?: { id?: unknown; scope?: unknown }; state?: unknown };
    return sub.rate_plan?.id === WORKERS_PAID_RATE_PLAN && sub.rate_plan.scope !== "zone" && !ENDED_STATES.has(String(sub.state));
  });
  return paid ? "paid" : "free";
}

/** Reads the account's Workers plan: Cloudflare first, then the explicit setting, then Free. One request. */
export async function detectD1Plan(call: CfCall, accountId: string, env: Env = process.env): Promise<PlanReading> {
  const setting = parseSetting(env);
  let why: string;
  try {
    const r = await call("GET", `/accounts/${accountId}/subscriptions`);
    const body = r.body as { success?: unknown; result?: unknown } | undefined;
    const plan = r.status === 200 && body?.success === true ? planFromSubscriptions(body.result) : undefined;
    if (plan !== undefined) {
      const disagrees = setting !== undefined && setting !== plan ? `; ${PLAN_SETTING_ENV}=${setting} ignored` : "";
      return { plan, source: "api", detail: `the account's subscriptions ${plan === "paid" ? "include" : "do not include"} Workers Paid${disagrees}` };
    }
    why = `listing the account's subscriptions answered HTTP ${String(r.status)} (it needs "Billing Read")`;
  } catch (error) {
    why = `listing the account's subscriptions failed: ${(error instanceof Error ? error.message : String(error)).split("\n")[0] ?? ""}`;
  }
  if (setting !== undefined) return { plan: setting, source: "setting", detail: `${why}; ${PLAN_SETTING_ENV}=${setting}` };
  return { plan: "free", source: "default", detail: `${why}; ${PLAN_SETTING_ENV} not set, so the Free budget applies` };
}

/** The budget of a plan. */
export function d1Budget(plan: D1Plan): D1Budget {
  return D1_BUDGETS[plan];
}

/**
 * The budget test processes apply, without any request: the plan the driver read for this run
 * (`COMPLIANCE_D1_PLAN`), else the explicit setting, else Free.
 */
export function runD1Budget(env: Env = process.env): D1Budget {
  const run = env[RUN_PLAN_ENV];
  if (run === "free" || run === "paid") return D1_BUDGETS[run];
  return D1_BUDGETS[parseSetting(env) ?? "free"];
}

/** One line for logs and evidence. */
export function describeBudget(b: D1Budget): string {
  const n = (x: number) => x.toLocaleString("en-US");
  return `${b.plan === "paid" ? "Workers Paid" : "Free"} D1 budget (${b.parameter}): per pass ≤ ${n(b.perPass.rowsWritten)} rows written and ≤ ${n(b.perPass.rowsRead)} read; per UTC day ≤ ${n(b.perDay.rowsWritten)} written and ≤ ${n(b.perDay.rowsRead)} read; ≤ ${String(b.maxDatabases)} D1 databases at once`;
}
