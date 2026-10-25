/**
 * AUTH-AC-005, admin-role part (docs/components/auth.md §4; AUTH-REQ-005 as amended, DEC-0526):
 * "automated on each cloud's `prodcheck` stage: a test signs up with an address under
 * `t.<domain>`, verifies through the mail sink and signs in, and `/api/auth/me` shows `user`.
 * Following the documented steps, it runs `admins grant <address> --target <t> --stage prodcheck
 * --confirm-production prodcheck`, and the next request with the same session shows `admin`. It
 * then runs `admins revoke` the same way, and the next request shows `user`."
 *
 * `prodcheck` is the reference app's long-lived production stage, redeployed by the cloud run
 * (COMPL §2); its origin comes from its recorded deploy output, the domain from the account
 * settings record (MAIL-REQ-003, so no test holds it), and the mail from the sink through
 * `mail last --target cloudflare`. Only `sink@` and `sink+<tag>@t.<domain>` are delivered (DEC-0527),
 * so the address is `sink+auth-ac-005-<random>@t.<domain>` (`sinkAddress`). The role is revoked before the test ends, also when it fails
 * (COMPL §2 "Production-check stage").
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sinkAddress } from "../../../../packages/framework/src/provision/cloudflare/email.js";
import { tag, target } from "../../harness/index.js";
import { requireCloudD1 } from "../_cloud/d1.js";
import { admins, emailDomain, leaks, recordedOrigin, sinkMail } from "../cli/support/admins.js";
import type { CommandResult } from "../core/support/processes.js";
import { isLocal } from "../core/support/repo.js";
import { createVerifiedAccount, expectAnswer, httpBrowser, linkToken, me, signIn, testDisplayName, testIp, testPassword, type Account, type AuthBrowser } from "../pwd/support.js";

if (!isLocal()) {
  describe("AUTH-AC-005 admin-role part on prodcheck", () => {
    it(
      tag("AUTH-AC-005", "admin-role part (prodcheck): sign-up under t.<domain>, verification through the mail sink and sign-in show user; admins grant … --confirm-production prodcheck makes the next request admin; admins revoke makes it user again"),
      async () => {
        const t = target();
        requireCloudD1(t.target);
        const origin = recordedOrigin(t.target, "prodcheck");
        const domain = await emailDomain();
        const a: Account = { email: sinkAddress(domain, `auth-ac-005-${randomBytes(6).toString("hex")}`), password: testPassword(), displayName: testDisplayName("AUTH 005") };
        const b: AuthBrowser = { ...httpBrowser({ baseUrl: origin }), mail: sinkMail() };
        const verifyMail = await createVerifiedAccount(b, a, testIp());
        expectAnswer(await signIn(b, a.email, a.password, { ip: testIp() }), 200);
        const before = await me(b);
        expect(before.level, "after sign-up, verification and sign-in").toBe("user");
        const id = before.id ?? "";
        const prod = ["--target", t.target, "--stage", "prodcheck", "--confirm-production", "prodcheck"];
        const outputs: CommandResult[] = [];
        let granted = false;
        try {
          const grant = await admins(["grant", a.email, ...prod]);
          outputs.push(grant);
          expect(grant.status, `admins grant: ${grant.output}`).toBe(0);
          granted = true;
          expect(await me(b), "the next request with the same session").toMatchObject({ level: "admin", id });
          expectAnswer(await b.get("/api/levels/admin"), 200);
          const revoke = await admins(["revoke", a.email, ...prod]);
          outputs.push(revoke);
          expect(revoke.status, `admins revoke: ${revoke.output}`).toBe(0);
          granted = false;
          expect(await me(b), "the next request after the revoke").toMatchObject({ level: "user", id });
          expectAnswer(await b.get("/api/levels/admin"), 403, "AUTH.FORBIDDEN");
        } finally {
          if (granted) await admins(["revoke", a.email, ...prod]);
        }
        const needles = { password: a.password, "verification token": linkToken(verifyMail, "verify", origin), "API token": process.env.CLOUDFLARE_API_TOKEN };
        for (const r of outputs) expect(leaks(r.output, needles), `${r.command}: output`).toEqual([]);
      },
      900_000,
    );
  });
}
