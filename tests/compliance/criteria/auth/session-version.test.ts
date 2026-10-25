/**
 * AUTH-AC-012, last clause (docs/components/auth.md §4, §2 "Session cookie"; DEC-0524): "A
 * version 1 session cookie is anonymous."
 *
 * A version 1 cookie must carry a good signature, or it would be anonymous for that reason
 * alone. The session key exists only inside the deployment, except under `dev`, where it is the
 * generated `frameworkSessionKey` in the reference app's `.dev.vars` (SEC §2 "Local"). So this
 * runs against the run's `dev` server: it signs in with the password provider, takes the issued
 * (version 2) cookie, checks that re-signing it unchanged reproduces it and is accepted (the
 * token format of DEC-0167: `base64url(JSON).base64url(HMAC-SHA-256)` over `session.<payload>`,
 * keyed with the key's UTF-8 bytes), then sends two version 1 cookies signed the same way: the
 * same payload with format version 1, and one also without the provider id and subject that
 * version 2 added.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prerequisiteMissing, tag } from "../../harness/index.js";
import { readDevVars } from "../core/support/processes.js";
import { isLocal, REFERENCE_APP_NAME, REFERENCE_DIR, secretLocation } from "../core/support/repo.js";
import { createVerifiedAccount, expectAnswer, httpBrowser, localSubjectOf, me, newAccount, sessionCookieNameFor, signIn, testIp } from "../pwd/support.js";

const b64url = (data: Buffer | string): string => Buffer.from(data).toString("base64url");

if (isLocal()) {
  describe("AUTH-AC-012 under dev: session format version 1", () => {
    it(tag("AUTH-AC-012", "under dev: a version 1 session cookie, validly signed with the stage's session key, is anonymous"), async () => {
      const b = httpBrowser();
      const a = newAccount("auth-ac-012-v1");
      await createVerifiedAccount(b, a, testIp());
      expectAnswer(await signIn(b, a.email, a.password, { ip: testIp() }), 200);
      expect((await me(b)).level).toBe("user");
      const name = sessionCookieNameFor(b);
      const issued = b.cookies()[name] ?? "";
      expect(issued, "the sign-in set the session cookie").not.toBe("");

      const key = readDevVars(REFERENCE_DIR).get(secretLocation("local", REFERENCE_APP_NAME, "local", "frameworkSessionKey"));
      if (key === undefined || key === "") prerequisiteMissing("the reference app's .dev.vars has no frameworkSessionKey; dev generates it on its first start");
      const [payloadPart = "", signature = ""] = issued.split(".");
      const json = Buffer.from(payloadPart, "base64url").toString("utf8");
      const hmac = (input: string): string => b64url(createHmac("sha256", Buffer.from(key, "utf8")).update(input).digest());
      // "over `<purpose>.<payload>`": the payload as sent (base64url) or as JSON text.
      const signers: ((p: string, j: string) => string)[] = [(p) => hmac(`session.${p}`), (_p, j) => hmac(`session.${j}`)];
      const sign = signers.find((s) => s(payloadPart, json) === signature);
      expect(sign, "the issued cookie is base64url(JSON).base64url(HMAC-SHA-256 over session.<payload>) keyed with frameworkSessionKey (DEC-0167)").toBeDefined();
      if (sign === undefined) return;
      const cookieOf = (payload: Record<string, unknown>): string => {
        const j = JSON.stringify(payload);
        const p = b64url(j);
        return `${name}=${p}.${sign(p, j)}`;
      };
      const send = async (cookie: string): Promise<unknown> => expectAnswer(await b.get("/api/auth/me", { cookies: false, headers: { cookie } }), 200).json();

      const payload = JSON.parse(json) as Record<string, unknown>;
      // Control: the unchanged payload, re-signed, is the same session.
      expect(await send(cookieOf(payload)), "control: the re-signed version 2 payload is accepted").toMatchObject({ level: "user" });

      const versionKeys = Object.keys(payload).filter((k) => payload[k] === 2 && /^(v|ver|version|fmt|format|formatVersion)$/i.test(k));
      expect(versionKeys, `the payload's format version field is 2 (auth.md §2, DEC-0524): ${Object.keys(payload).join(", ")}`).toHaveLength(1);
      const versionKey = versionKeys[0] ?? "v";
      const subject = localSubjectOf(a.email);
      const v2Only = Object.keys(payload).filter((k) => payload[k] === "password" || payload[k] === subject);
      expect(v2Only.length, "the version 2 payload names the provider and the provider's subject").toBeGreaterThan(0);

      const sameShape = { ...payload, [versionKey]: 1 };
      const v1Shape = Object.fromEntries(Object.entries(sameShape).filter(([k]) => !v2Only.includes(k)));
      for (const [what, p] of [
        ["format version 1, otherwise unchanged", sameShape],
        ["format version 1 without the provider id and subject", v1Shape],
      ] as const) {
        const cookie = cookieOf(p);
        expect(await send(cookie), `${what}: /api/auth/me`).toStrictEqual({ level: "anonymous" });
        expectAnswer(await b.get("/api/levels/user", { cookies: false, headers: { cookie } }), 401, "AUTH.UNAUTHENTICATED");
      }
    });
  });
}
