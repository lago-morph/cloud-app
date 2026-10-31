/**
 * `TestApp.authApp` over the in-memory fake auth app (DEC-0734). `./testing` names a person by
 * subject and role only (CORE-REQ-005, AUTH-REQ-001; E2E-005), while the fake keeps the internal
 * binding's identity (internal/auth-app.d.ts), which carries an email address. The adapter makes one
 * up, `<sub>@auth-app.test` (a reserved test domain), so the fake's redeem keeps its shape and
 * AUTH-AC-013 can check that no response carries it. Not exported from `./testing`: its signature
 * names the internal binding's types, which must stay out of `./testing`'s declarations.
 */
import type { AuthAppIdentity, FakeAuthAppBinding } from "../auth/auth-app-binding.js";
import type { TestAuthApp } from "./test-app.js";

/** The internal identity the fake is handed for a `./testing` identity. */
export function authAppIdentity(identity: { readonly sub: string; readonly role: "admin" | "user" }): AuthAppIdentity {
  return { sub: identity.sub, email: `${identity.sub}@auth-app.test`, role: identity.role };
}

/** The fake auth app as a test sees it: `issueCode` takes `{ sub, role }`; the rest is the fake's. */
export function testAuthApp(fake: FakeAuthAppBinding): TestAuthApp {
  return {
    issueCode: (identity, options) => fake.issueCode(authAppIdentity(identity), options),
    setRole: (sub, role) => fake.setRole(sub, role),
    unregisterApp: (app) => fake.unregisterApp(app),
    failNext: (n) => fake.failNext(n),
    setUnavailable: (unavailable) => fake.setUnavailable(unavailable),
    get calls() {
      return fake.calls;
    },
  };
}
