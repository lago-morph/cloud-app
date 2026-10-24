/**
 * AWS-AC-006 (aws.md §4; AWS-REQ-001): "A reference route that sets two cookies delivers both,
 * through CloudFront and directly at the Function URL."
 *
 * The route is `GET /api/ref/two-cookies` (apps/reference/ROUTES.md): `refOne=1` and `refTwo=2`,
 * each `Path=/; HttpOnly; SameSite=Lax`, as two `Set-Cookie` headers; body
 * `{ cookies: ["refOne", "refTwo"] }`. "Delivers both" = the response has two separate
 * `Set-Cookie` headers carrying those cookies with those attributes (not folded into one, not
 * one dropped), and the client's cookie jar holds both afterwards. Checked once through the
 * CloudFront origin (the response carries `x-amz-cf-id`) and once at the Function URL directly
 * (found through the AWS cloud hooks; no `x-amz-cf-id`).
 *
 * Cloud usage: 2 HTTP requests to the stage; one Lambda API request; no database rows.
 */
import { describe, expect, it } from "vitest";
import { client, tag, target, type ComplianceClient } from "../../harness/index.js";
import { setCookies } from "../auth/support.js";
import { runDeployment } from "../core/support/repo.js";
import { awsHooks, directClient } from "./support.js";

async function deliversBoth(c: ComplianceClient, via: string, viaCloudFront: boolean): Promise<void> {
  const r = c.expectStatus(await c.get("/api/ref/two-cookies"), 200);
  const cf = r.headers.get("x-amz-cf-id");
  if (viaCloudFront) expect(cf ?? "", `${via}: served through CloudFront`).not.toBe("");
  else expect(cf, `${via}: served by the Function URL directly`).toBeNull();
  expect(r.json(), `${via}: body`).toEqual({ cookies: ["refOne", "refTwo"] });

  const cookies = setCookies(r.headers);
  expect(cookies.map((k) => k.name).sort(), `${via}: one Set-Cookie header per cookie`).toEqual(["refOne", "refTwo"]);
  for (const [name, value] of [["refOne", "1"], ["refTwo", "2"]] as const) {
    const k = cookies.find((x) => x.name === name);
    expect(k?.value, `${via}: ${name} value`).toBe(value);
    expect(k?.attributes.get("path"), `${via}: ${name} Path`).toBe("/");
    expect(k?.attributes.has("httponly"), `${via}: ${name} HttpOnly`).toBe(true);
    expect(k?.attributes.get("samesite")?.toLowerCase(), `${via}: ${name} SameSite`).toBe("lax");
  }
  expect(c.cookies(), `${via}: the client holds both cookies`).toMatchObject({ refOne: "1", refTwo: "2" });
}

if (target().target === "aws") {
  describe("AWS-AC-006 two cookies (aws)", () => {
    it(tag("AWS-AC-006", "the two-cookies route delivers both cookies through CloudFront and directly at the Function URL"), async () => {
      const hooks = await awsHooks("AWS-AC-006");
      const run = runDeployment();
      const functionUrl = await hooks.functionUrl({ app: run.app, stage: run.stage });
      const viaCloudFront = client();
      await deliversBoth(viaCloudFront, "through CloudFront", true);
      await deliversBoth(directClient(viaCloudFront.baseUrl, functionUrl), "directly at the Function URL", false);
    });
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on other targets.
  describe("AWS-AC-006 (aws only)", () => {
    it("has nothing to run on this target", () => undefined);
  });
}
