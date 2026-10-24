/**
 * AWS-AC-004 (aws.md §4; AWS-REQ-004, DEC-0044): "The protected-route acceptance criteria
 * (AUTH-AC-004, AUTH-AC-007) pass when sent directly to the Function URL."
 *
 * Runs against the run's stage. The Function URL is discovered through the AWS cloud hooks. The
 * requests go to it directly (`directClient`), bypassing CloudFront: each response must lack
 * CloudFront's `x-amz-cf-id`, which shows the bypass. The client behaves as a browser on the
 * public origin, the CloudFront URL (aws.md §2), so its default `Origin` is that origin.
 *
 * AUTH-AC-004 (auth.md; ROUTES.md "Access levels"): anonymous → 401 `AUTH.UNAUTHENTICATED` on
 * user and admin routes; a user → 200 on user routes and 403 `AUTH.FORBIDDEN` on admin routes;
 * an admin → 200 on both; `requireCurrentUser` (`/levels/current`) returns the user and throws
 * `AUTH.UNAUTHENTICATED` when anonymous. AUTH-AC-007: a POST with a session is rejected with
 * `AUTH.REQUEST_FORGERY` when `Origin` is missing or wrong (including the Function URL's own
 * origin, which is not the public origin) and accepted when it equals the public origin.
 *
 * Cloud usage: about 35 HTTP requests to the Function URL; one Lambda API request; no
 * database rows.
 */
import { describe, expect, it } from "vitest";
import { client, tag, target, type ComplianceClient, type HttpResponse } from "../../harness/index.js";
import { catalogueStatus, runDeployment } from "../core/support/repo.js";
import { awsHooks, directClient } from "./support.js";

function bypassed(r: HttpResponse): HttpResponse {
  expect(r.headers.get("x-amz-cf-id"), `${r.method} ${r.path} reached the Function URL directly, not through CloudFront`).toBeNull();
  return r;
}

if (target().target === "aws") {
  describe("AWS-AC-004 direct Function URL access (aws)", () => {
    it(tag("AWS-AC-004", "AUTH-AC-004 and AUTH-AC-007 pass when sent directly to the Function URL"), async () => {
      const hooks = await awsHooks("AWS-AC-004");
      const run = runDeployment();
      const publicBase = client().baseUrl;
      const functionUrl = await hooks.functionUrl({ app: run.app, stage: run.stage });
      const functionOrigin = new URL(functionUrl).origin;
      expect(new URL(functionUrl).hostname, "the Function URL").toMatch(/\.lambda-url\.[a-z0-9-]+\.on\.aws$/);
      expect(functionOrigin, "the Function URL is not the public origin").not.toBe(new URL(publicBase).origin);
      const direct = (): ComplianceClient => directClient(publicBase, functionUrl);
      const as = async (level: "user" | "admin", id: string): Promise<ComplianceClient> => {
        const c = direct();
        await c.loginAs(level, { id });
        return c;
      };
      const unauthenticated = catalogueStatus("AUTH.UNAUTHENTICATED");
      const forbidden = catalogueStatus("AUTH.FORBIDDEN");
      const forgery = catalogueStatus("AUTH.REQUEST_FORGERY");

      // AUTH-AC-004: anonymous.
      const anon = direct();
      anon.expectStatus(bypassed(await anon.get("/api/levels/anyone")), 200);
      for (const path of ["/api/levels/user", "/api/levels/admin"]) {
        anon.expectError(bypassed(await anon.get(path)), unauthenticated, "AUTH.UNAUTHENTICATED");
        anon.expectError(bypassed(await anon.post(path, {})), unauthenticated, "AUTH.UNAUTHENTICATED");
      }
      anon.expectError(bypassed(await anon.get("/api/levels/current")), unauthenticated, "AUTH.UNAUTHENTICATED");

      // AUTH-AC-004: user.
      const user = await as("user", "g-t2-aws004-user");
      for (const r of [await user.get("/api/levels/user"), await user.post("/api/levels/user", {})]) {
        expect(user.expectStatus(bypassed(r), 200).json(), `${r.method} ${r.path} as user`).toStrictEqual({ level: "user", id: "g-t2-aws004-user" });
      }
      user.expectError(bypassed(await user.get("/api/levels/admin")), forbidden, "AUTH.FORBIDDEN");
      user.expectError(bypassed(await user.post("/api/levels/admin", {})), forbidden, "AUTH.FORBIDDEN");
      expect(user.expectStatus(bypassed(await user.get("/api/levels/current")), 200).json(), "requireCurrentUser as user").toStrictEqual({ level: "user", id: "g-t2-aws004-user" });

      // AUTH-AC-004: admin.
      const admin = await as("admin", "g-t2-aws004-admin");
      for (const path of ["/api/levels/user", "/api/levels/admin"]) {
        expect(admin.expectStatus(bypassed(await admin.get(path)), 200).json(), `GET ${path} as admin`).toStrictEqual({ level: "admin", id: "g-t2-aws004-admin" });
        expect(admin.expectStatus(bypassed(await admin.post(path, {})), 200).json(), `POST ${path} as admin`).toStrictEqual({ level: "admin", id: "g-t2-aws004-admin" });
      }
      expect(admin.expectStatus(bypassed(await admin.get("/api/levels/current")), 200).json(), "requireCurrentUser as admin").toStrictEqual({ level: "admin", id: "g-t2-aws004-admin" });

      // AUTH-AC-007: missing Origin.
      const session = await as("user", "g-t2-aws004-forgery");
      session.expectError(bypassed(await session.post("/api/levels/user", {}, { origin: false })), forgery, "AUTH.REQUEST_FORGERY");
      session.expectError(bypassed(await session.post("/api/auth/logout", undefined, { origin: false })), forgery, "AUTH.REQUEST_FORGERY");
      expect(session.expectStatus(bypassed(await session.get("/api/auth/me")), 200).json(), "the rejected logout did not end the session").toMatchObject({ level: "user", id: "g-t2-aws004-forgery" });

      // AUTH-AC-007: wrong Origin, including the Function URL's own origin.
      const pub = new URL(publicBase);
      const wrong = [functionOrigin, "https://evil.example", "null", `https://${pub.host}.evil.example`, `http://${pub.host}`, `${pub.origin}/`, pub.origin.toUpperCase()].filter((o) => o !== pub.origin);
      for (const origin of wrong) {
        session.expectError(bypassed(await session.post("/api/levels/user", {}, { origin })), forgery, "AUTH.REQUEST_FORGERY");
      }

      // AUTH-AC-007: Origin equal to the public origin.
      expect(session.expectStatus(bypassed(await session.post("/api/levels/user", {}, { origin: pub.origin })), 200).json(), "POST with the public origin").toStrictEqual({ level: "user", id: "g-t2-aws004-forgery" });
      session.expectStatus(bypassed(await session.post("/api/auth/logout", undefined, { origin: pub.origin })), 204);
    });
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on other targets.
  describe("AWS-AC-004 (aws only)", () => {
    it("has nothing to run on this target", () => undefined);
  });
}
