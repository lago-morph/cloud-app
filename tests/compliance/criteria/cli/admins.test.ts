/**
 * The `admins` command (docs/components/cli.md CLI-REQ-005, §2 `admins`; DEC-0523).
 *
 * - CLI-AC-006 (Local): "Against the reference app's local D1 (`--target local`): after a sign-up
 *   and verification through `dev`, `admins grant <address>` exits 0 and prints the account's
 *   user ID, which equals `/api/auth/me`'s `id`. The next request with the person's existing
 *   session shows `admin`, with no new login and no restart. `admins list` shows the address with
 *   `admin`. `admins revoke <address>` makes the next request `user`, and the `role` column is
 *   NULL afterwards. A second grant, and a revoke of a non-admin, change nothing and exit 0. An
 *   unknown address and an unverified account each exit 1 and change nothing. The output of
 *   every run, scanned with the test passwords, the stored password hash and every verification
 *   token and session cookie of the test, contains none of them."
 *   Run against the run's `dev` server of the reference app, whose persisted local D1 the command
 *   opens itself ("whether or not `dev` is running"); the mail is read from `.mail/`, the role
 *   column and the stored hash from the local D1 files (read-only).
 * - CLI-AC-007 (Cloud): on the run's Cloudflare test stage, grant and revoke through the D1 HTTP
 *   API; for `prodcheck`, a missing or wrong `--confirm-production` exits 2 with no D1 API
 *   request, shown by recording the CLI process's outgoing requests (support/record-requests.mjs).
 */
import { describe, expect, it } from "vitest";
import { tag, target } from "../../harness/index.js";
import { requireCloudD1 } from "../_cloud/d1.js";
import type { CommandResult } from "../core/support/processes.js";
import { isLocal } from "../core/support/repo.js";
import {
  createVerifiedAccount,
  expectAnswer,
  expectResult,
  httpBrowser,
  linkToken,
  localRows,
  localSubjectOf,
  me,
  newAccount,
  par,
  rowsWith,
  sessionCookieNameFor,
  signIn,
  signUp,
  testAddress,
  testIp,
  type AuthBrowser,
} from "../pwd/support.js";
import { admins, d1ApiRequests, leaks, recordRequests } from "./support/admins.js";

async function levelOf(b: AuthBrowser): Promise<{ level: string; id?: string }> {
  const who = await me(b);
  const admin = await b.get("/api/levels/admin");
  if (who.level === "admin") expectAnswer(admin, 200);
  else if (who.level === "user") expectAnswer(admin, 403, "AUTH.FORBIDDEN");
  return who;
}

/** The `role` column of the local account with this subject. */
function localRole(subject: string): unknown {
  const row = localRows("__framework_auth_user").find((r) => r.id === subject);
  expect(row, "the account row").toBeDefined();
  expect(Object.keys(row ?? {}), "__framework_auth_user has a role column (PWD-REQ-008)").toContain("role");
  return row?.role;
}

/** Every account's role, to show that a refused run changed nothing. */
function localRoles(): string {
  return JSON.stringify(
    localRows("__framework_auth_user")
      .map((r) => [r.id, r.role ?? null, r.email_verified ?? null])
      .sort(),
  );
}

if (isLocal()) {
  describe("CLI-AC-006 admins against the reference app's local D1", () => {
    it(
      tag("CLI-AC-006", "after sign-up and verification through dev: grant prints the /api/auth/me ID and makes the next request admin; list shows it; revoke makes it user with a NULL role; repeats exit 0; an unknown or unverified address exits 1; no output leaks a password, hash, token or cookie"),
      async () => {
        const b = httpBrowser();
        const a = newAccount("cli-ac-006");
        const verifyMail = await createVerifiedAccount(b, a, testIp());
        const verifyToken = linkToken(verifyMail, "verify", b.publicOrigin);
        expectAnswer(await signIn(b, a.email, a.password, { ip: testIp() }), 200);
        const before = await levelOf(b);
        expect(before.level, "before the grant").toBe("user");
        const id = before.id ?? "";
        const session = b.cookies()[sessionCookieNameFor(b)];
        expect(session, "the sign-in set the session cookie").toBeDefined();
        const subject = localSubjectOf(a.email);
        const hashes = rowsWith(localRows("__framework_auth_account"), subject).flatMap((r) => Object.values(r).filter((v): v is string => typeof v === "string" && par.hashFormat().test(v)));
        expect(hashes.length, "the stored password hash (PAR-244 format)").toBeGreaterThan(0);

        const unverified = newAccount("cli-ac-006-unverified");
        expectResult(await signUp(httpBrowser(), unverified, { ip: testIp() }), "check-email");

        const outputs: CommandResult[] = [];
        const run = async (args: readonly string[]): Promise<CommandResult> => {
          const r = await admins([...args, "--target", "local"]);
          outputs.push(r);
          return r;
        };

        const grant = await run(["grant", a.email]);
        expect(grant.status, `admins grant: ${grant.output}`).toBe(0);
        expect(grant.output.toLowerCase(), "grant prints the account's user ID, as /api/auth/me shows it").toContain(id.toLowerCase());
        expect(await levelOf(b), "the next request with the existing session").toMatchObject({ level: "admin", id });
        expect(b.cookies()[sessionCookieNameFor(b)], "no new login").toBe(session);
        expect(localRole(subject)).toBe("admin");

        const list = await run(["list"]);
        expect(list.status, `admins list: ${list.output}`).toBe(0);
        const line = list.output.split("\n").find((l) => l.toLowerCase().includes(a.email.toLowerCase()));
        expect(line, `admins list names the address:\n${list.output}`).toBeDefined();
        expect(line ?? "", "with admin").toMatch(/\badmin\b/);
        expect((line ?? "").toLowerCase(), "and the user ID").toContain(id.toLowerCase());

        const again = await run(["grant", a.email]);
        expect(again.status, `a second grant: ${again.output}`).toBe(0);
        expect(localRole(subject), "a second grant changes nothing").toBe("admin");

        const revoke = await run(["revoke", a.email]);
        expect(revoke.status, `admins revoke: ${revoke.output}`).toBe(0);
        expect(await levelOf(b), "the next request after the revoke").toMatchObject({ level: "user", id });
        expect(localRole(subject), "the role column after the revoke is NULL").toBeNull();
        const listAfter = await run(["list"]);
        expect(listAfter.status).toBe(0);
        expect(listAfter.output.toLowerCase(), "the revoked account is no longer listed").not.toContain(a.email.toLowerCase());

        const revokeAgain = await run(["revoke", a.email]);
        expect(revokeAgain.status, `a revoke of a non-admin: ${revokeAgain.output}`).toBe(0);
        expect(localRole(subject), "a revoke of a non-admin changes nothing").toBeNull();

        for (const [what, address] of [
          ["an unknown address", testAddress("cli-ac-006-nobody")],
          ["an unverified account", unverified.email],
        ] as const) {
          for (const verb of ["grant", "revoke"]) {
            const roles = localRoles();
            const r = await run([verb, address]);
            expect(r.status, `${verb} for ${what}: ${r.output}`).toBe(1);
            expect(localRoles(), `${verb} for ${what} changes nothing`).toBe(roles);
          }
        }
        expect(await levelOf(b), "still user").toMatchObject({ level: "user", id });

        const needles = { password: a.password, "unverified password": unverified.password, "verification token": verifyToken, "session cookie": session, ...Object.fromEntries(hashes.map((h, i) => [`stored hash ${String(i)}`, h])) };
        for (const r of outputs) expect(leaks(r.output, needles), `${r.command}: output`).toEqual([]);
      },
      900_000,
    );
  });
} else {
  describe("CLI-AC-007 admins on a Cloudflare stage", () => {
    it(
      tag("CLI-AC-007", "on the test stage, after sign-up, verification through the test-mail route and sign-in, admins grant gives admin on the next request and admins revoke gives user again, through the D1 HTTP API; no output holds a password, token or API credential"),
      async () => {
        const t = target();
        requireCloudD1(t.target);
        const stage = t.stage ?? "";
        expect(stage, "the run's test stage").toMatch(/^test-/);
        const b = httpBrowser();
        const a = newAccount("cli-ac-007");
        const verifyMail = await createVerifiedAccount(b, a, testIp());
        const verifyToken = linkToken(verifyMail, "verify", b.publicOrigin);
        expectAnswer(await signIn(b, a.email, a.password, { ip: testIp() }), 200);
        const before = await levelOf(b);
        expect(before.level).toBe("user");
        const session = b.cookies()[sessionCookieNameFor(b)];
        const outputs: CommandResult[] = [];
        const recording = await recordRequests();
        try {
          const grant = await admins(["grant", a.email, "--target", t.target, "--stage", stage], { env: recording.env });
          outputs.push(grant);
          expect(grant.status, `admins grant: ${grant.output}`).toBe(0);
          expect(grant.output.toLowerCase()).toContain((before.id ?? "").toLowerCase());
          expect(await levelOf(b), "the next request after the grant").toMatchObject({ level: "admin", id: before.id });
          const revoke = await admins(["revoke", a.email, "--target", t.target, "--stage", stage], { env: recording.env });
          outputs.push(revoke);
          expect(revoke.status, `admins revoke: ${revoke.output}`).toBe(0);
          expect(await levelOf(b), "the next request after the revoke").toMatchObject({ level: "user", id: before.id });
          expect(d1ApiRequests(await recording.lines()).length, "grant and revoke went through the D1 HTTP API").toBeGreaterThan(0);
        } finally {
          await recording.dispose();
        }
        const needles = { password: a.password, "verification token": verifyToken, "session cookie": session, "API token": process.env.CLOUDFLARE_API_TOKEN };
        for (const r of outputs) expect(leaks(r.output, needles), `${r.command}: output`).toEqual([]);
      },
      900_000,
    );

    it(tag("CLI-AC-007", "for prodcheck, grant, revoke and list without --confirm-production prodcheck, or with another name, exit 2 and send no request to the D1 API"), async () => {
      const t = target();
      const address = testAddress("cli-ac-007-prodcheck");
      const cases: (readonly string[])[] = [];
      for (const verb of [["grant", address], ["revoke", address], ["list"]]) {
        cases.push([...verb]);
        cases.push([...verb, "--confirm-production", "prodcheck-other"]);
        cases.push([...verb, "--confirm-production", "test-x"]);
      }
      for (const args of cases) {
        const recording = await recordRequests();
        try {
          const r = await admins([...args, "--target", t.target, "--stage", "prodcheck"], { env: recording.env });
          expect(r.status, `admins ${args.join(" ")} --stage prodcheck: ${r.output}`).toBe(2);
          const lines = await recording.lines();
          expect(lines[0], "the request recorder ran in the CLI process").toBe("started");
          expect(d1ApiRequests(lines), `admins ${args.join(" ")}: no D1 API request`).toEqual([]);
          expect(leaks(r.output, { "API token": process.env.CLOUDFLARE_API_TOKEN }), "output").toEqual([]);
        } finally {
          await recording.dispose();
        }
      }
    });
  });
}
