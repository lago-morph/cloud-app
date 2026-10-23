/**
 * AUTH test helpers (contract: docs/contracts/ts/testing.d.ts: `mockUsers`). Identities for the
 * authentication mock: the user ID is used as given (AUTH-REQ-009).
 */
import { MOCK_DEFAULT_IDS } from "./mock-ids.js";
import type { CurrentUser } from "./public.js";

export const mockUsers: {
  readonly anonymous: CurrentUser;
  readonly user: (id?: string) => CurrentUser;
  readonly admin: (id?: string) => CurrentUser;
} = Object.freeze({
  anonymous: Object.freeze({ level: "anonymous" }) as CurrentUser,
  user: (id: string = MOCK_DEFAULT_IDS.user): CurrentUser => Object.freeze({ level: "user", id, displayName: null }),
  admin: (id: string = MOCK_DEFAULT_IDS.admin): CurrentUser => Object.freeze({ level: "admin", id, displayName: null }),
});
