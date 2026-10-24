/**
 * Login transaction cookie contents (auth.md §2 "Login" step 2): the provider's transaction
 * state, the sanitised `returnTo`, and an expiry (PAR-251), signed with the session key.
 */
import { signToken, verifyToken } from "./signing.js";

/** PAR-251: validity of an in-progress login (10 minutes), in seconds. */
export const LOGIN_LIFETIME_SECONDS = 10 * 60;

const VERSION = 1;

export interface TransactionData {
  readonly state: string;
  readonly returnTo: string;
}

export async function issueTransaction(key: string, data: TransactionData, nowMs: number): Promise<string> {
  return signToken(key, "login", { v: VERSION, st: data.state, rt: data.returnTo, exp: Math.floor(nowMs / 1000) + LOGIN_LIFETIME_SECONDS });
}

export async function readTransaction(key: string, token: string, nowMs: number): Promise<TransactionData | undefined> {
  const payload = await verifyToken(key, "login", token);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  const p = payload as Record<string, unknown>;
  const { st, rt, exp } = p;
  if (p["v"] !== VERSION || typeof st !== "string" || typeof rt !== "string" || typeof exp !== "number") return undefined;
  if (nowMs / 1000 >= exp) return undefined;
  return { state: st, returnTo: rt };
}
