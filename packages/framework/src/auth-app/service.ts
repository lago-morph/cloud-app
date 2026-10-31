/**
 * The auth app's side of the service binding `env.AUTH` (contract
 * docs/contracts/ts/internal/auth-app.d.ts; plan §4.1 steps 4–5; DEC-0650). Arguments arrive over
 * RPC unchecked, so a value of the wrong shape is a refusal (`null`). A store failure becomes one
 * plain Error, "auth app unavailable", so the app can retry; its message carries no detail.
 */
import type { AuthAppBinding, AuthAppIdentity, AuthAppRole } from "../auth/auth-app-binding.js";
import { getRole, redeemCode, type D1Like } from "./store.js";

export interface AuthAppServiceDeps {
  readonly db: D1Like;
  readonly now: () => number;
  /** Called with the underlying error before the generic rejection (for the Worker's log). */
  readonly onError?: (error: unknown) => void;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function createAuthAppService(deps: AuthAppServiceDeps): AuthAppBinding {
  const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      deps.onError?.(error);
      throw new Error("auth app unavailable");
    }
  };
  return {
    async redeem(input: unknown): Promise<AuthAppIdentity | null> {
      if (!isRecord(input) || typeof input.code !== "string" || typeof input.app !== "string") return null;
      const { code, app } = input;
      return guarded(() => redeemCode(deps.db, { code, app }, deps.now()));
    },
    async role(sub: unknown): Promise<AuthAppRole | null> {
      if (typeof sub !== "string" || sub === "") return null;
      return guarded(() => getRole(deps.db, sub));
    },
  } satisfies AuthAppBinding; // methods take unknown: RPC arguments arrive unchecked
}
