/**
 * AUTH test helpers (contract: docs/contracts/ts/testing.d.ts: `mockUsers`).
 * Stub written by B-01; implemented by B-12.
 */
import type { CurrentUser } from "./public.js";

function notImplemented(): never {
  throw new Error("not implemented: mockUsers");
}

export const mockUsers: {
  readonly anonymous: CurrentUser;
  readonly user: (id?: string) => CurrentUser;
  readonly admin: (id?: string) => CurrentUser;
} = {
  get anonymous(): CurrentUser {
    return notImplemented();
  },
  user: () => notImplemented(),
  admin: () => notImplemented(),
};
