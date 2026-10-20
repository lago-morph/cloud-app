/**
 * E2E-007 — Becoming an admin, local part (Where: Local; cloud (milestone)).
 *
 * "Locally this runs as an in-process test (createTestApp with the stub login provider), not
 * through dev, because dev uses the mock, which ignores the admin list; the redeploy is a
 * rebuild." The documented steps: log in; copy the user ID from the account page (its data is
 * `GET /api/auth/me`, the route the account page reads, framework.openapi.yaml); add it to the
 * admin list in configuration (`framework.admins`); redeploy (a new `createTestApp`, which is
 * one build). Pass: the user is admin after the redeploy and not before.
 *
 * The cloud part runs on `prodcheck` during certification and is not run in this phase
 * ("Google login mocked for this phase", plan §8.1); the driver records it.
 */
import { tag, target } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { randomSuffix } from "./support/apps.js";
import { referenceTestApp } from "./support/in-process.js";

interface Me {
  readonly level: string;
  readonly id?: string;
  readonly displayName?: string | null;
}

if (target().target === "local") {
  test(tag("E2E-007", "local part: a user whose ID is copied from the account page into the admin list is admin after the rebuild and not before"), async () => {
    const subject = `e2e007-${randomSuffix()}`;

    // 1. Log in (stub login provider: real login, callback, ID derivation and admin-list paths).
    const before = await referenceTestApp({ stubLoginProvider: true, config: { framework: {} } });
    let userId: string;
    try {
      await before.loginWithStub(subject, { displayName: "E2E Seven" });
      // 2. Copy the user ID from the account page's data.
      const me = (await (await before.request("/api/auth/me")).json()) as Me;
      expect(me.level).toBe("user");
      expect(typeof me.id).toBe("string");
      userId = me.id ?? "";
      expect(userId).not.toBe("");
      expect(userId, "the user ID is derived, not the provider's subject").not.toBe(subject);
      // Not admin before the change.
      const adminBefore = await before.request("/api/levels/admin");
      expect(adminBefore.status).toBe(403);
      expect(((await adminBefore.json()) as { error: { code: string } }).error.code).toBe("AUTH.FORBIDDEN");
      expect((await (await before.request("/api/levels/user")).json()) as unknown).toEqual({ level: "user", id: userId });
    } finally {
      await before.dispose();
    }

    // 3. Add it to the admin list; 4. redeploy (rebuild).
    const after = await referenceTestApp({ stubLoginProvider: true, config: { framework: { admins: [userId] } } });
    try {
      await after.loginWithStub(subject, { displayName: "E2E Seven" });
      const me = (await (await after.request("/api/auth/me")).json()) as Me;
      expect(me).toEqual({ level: "admin", id: userId, displayName: "E2E Seven" });
      const adminAfter = await after.request("/api/levels/admin");
      expect(adminAfter.status).toBe(200);
      expect(await adminAfter.json()).toEqual({ level: "admin", id: userId });
    } finally {
      await after.dispose();
    }
  });
}
