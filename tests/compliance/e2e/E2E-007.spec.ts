/**
 * E2E-007 — Becoming an admin, local part (docs/acceptance/e2e-scenarios.md; Where: Local, cloud;
 * DEC-0521, DEC-0523, DEC-0526). Rewritten for the amended scenario: admins are a role granted
 * with `admins`, not a list in configuration.
 *
 * "Follow only the documented steps:
 *  1. Sign up and sign in to a stage: sign up, read the verification mail with `mail last`,
 *     verify, and sign in. Check that `/api/auth/me` shows level `user`, and that an admin-only
 *     reference route answers 403 `AUTH.FORBIDDEN`.
 *  2. Grant the role: `admins grant <address> --target <t> --stage <s>` …
 *  3. Send the next request with the same session: no new login, no deploy.
 *  4. Revoke the role with `admins revoke`, and send one more request.
 *  Locally this runs through `dev` and the reference app's local D1, with `--target local`."
 * Pass: `user` before the grant; `admin` (the admin-only route answers 200) on the first request
 * after it; `user` again on the first request after the revoke; the account has no role stored
 * afterwards.
 *
 * The run's `dev` server of the reference app is the stage (the driver starts it); the mail is
 * read with `mail last --to <address>` from its `.mail/`, and the stored role from its local D1
 * (read-only). The cloud part runs on `prodcheck` in criteria/auth/admin-role.test.ts, with
 * AUTH-AC-005's admin-role part (one sign-up and one real send for both).
 */
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { client, target, waitFor, type ComplianceClient } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { tag } from "../harness/index.js";
import { frameworkCli, REFERENCE_DIR, tail } from "./support/process.js";

interface Me {
  readonly level: string;
  readonly id?: string;
}

/** The `role` column of the account with this address in the reference app's local D1 (read-only). */
function storedRole(email: string): unknown {
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".sqlite") && entry !== "metadata.sqlite" && full.includes(`${sep}d1${sep}`)) files.push(full);
    }
  };
  const root = join(REFERENCE_DIR, ".wrangler");
  if (existsSync(root)) walk(root);
  for (const file of files) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__framework_auth_user'").get() === undefined) continue;
      const row = db.prepare(`SELECT role FROM "__framework_auth_user" WHERE email = ?`).get(email) as { role?: unknown } | undefined;
      if (row !== undefined) return row.role;
    } finally {
      db.close();
    }
  }
  throw new Error("no account with the test address in the reference app's local D1");
}

async function me(c: ComplianceClient, headers: Record<string, string>): Promise<Me> {
  return c.expectStatus(await c.get("/api/auth/me", { headers }), 200).json<Me>();
}

if (target().target === "local") {
  test(tag("E2E-007", "local part: sign up through dev, read the mail with mail last, verify and sign in as user; admins grant makes the next request admin; admins revoke makes it user again, with no role stored"), async () => {
    test.setTimeout(600_000);
    const suffix = randomBytes(6).toString("hex");
    const email = `e2e-007-${suffix}@example.test`;
    const password = `Pw${randomBytes(12).toString("hex")}`;
    // A client IP of its own (PWD-REQ-006 counts per IP; dev takes CF-Connecting-IP when set).
    const ip = `10.7.${String(randomBytes(1)[0] ?? 1)}.${String(((randomBytes(1)[0] ?? 1) % 250) + 2)}`;
    const headers = { accept: "application/json", "cf-connecting-ip": ip };
    const c = client();

    // 1. Sign up, read the verification mail with `mail last`, verify, sign in.
    const signUp = c.expectStatus(await c.post("/api/auth/password/sign-up", { email, password, displayName: "E2E Seven" }, { headers }), 200);
    expect(signUp.json<{ result?: string }>().result).toBe("check-email");
    const mail = await waitFor(
      async () => {
        const r = await frameworkCli(REFERENCE_DIR, ["mail", "last", "--to", email], { timeoutMs: 60_000 });
        if (r.status !== 0) return undefined;
        const message = JSON.parse(r.output.slice(r.output.indexOf("{"))) as { text?: string; html?: string };
        return `${message.text ?? ""}\n${message.html ?? ""}`;
      },
      { what: "the verification mail through mail last", timeoutMs: 60_000, intervalMs: 500 },
    );
    const link = /https?:\/\/[^\s"'<>]+\/api\/auth\/verify\?token=[^\s"'<>&]+/.exec(mail)?.[0];
    expect(link, "the verification mail has a /api/auth/verify?token= link").toBeDefined();
    const token = new URL(link ?? "http://x/").searchParams.get("token") ?? "";
    expect(c.expectStatus(await c.post("/api/auth/password/verify", { token }, { headers }), 200).json<{ result?: string }>().result).toBe("verified");
    expect(c.expectStatus(await c.post("/api/auth/password/sign-in", { email, password }, { headers }), 200).json<{ result?: string }>().result).toBe("signed-in");
    const before = await me(c, headers);
    expect(before.level, "before the grant").toBe("user");
    const id = before.id ?? "";
    c.expectError(await c.get("/api/levels/admin", { headers }), 403, "AUTH.FORBIDDEN");
    const session = JSON.stringify(c.cookies());

    // 2. Grant the role. 3. The next request with the same session.
    const grant = await frameworkCli(REFERENCE_DIR, ["admins", "grant", email, "--target", "local"], { timeoutMs: 300_000 });
    expect(grant.status, `admins grant:\n${tail(grant.output)}`).toBe(0);
    expect(await me(c, headers), "the first request after the grant").toEqual(expect.objectContaining({ level: "admin", id }));
    c.expectStatus(await c.get("/api/levels/admin", { headers }), 200);
    expect(JSON.stringify(c.cookies()), "no new login").toBe(session);

    // 4. Revoke the role, and one more request.
    const revoke = await frameworkCli(REFERENCE_DIR, ["admins", "revoke", email, "--target", "local"], { timeoutMs: 300_000 });
    expect(revoke.status, `admins revoke:\n${tail(revoke.output)}`).toBe(0);
    expect(await me(c, headers), "the first request after the revoke").toEqual(expect.objectContaining({ level: "user", id }));
    c.expectError(await c.get("/api/levels/admin", { headers }), 403, "AUTH.FORBIDDEN");
    expect(storedRole(email), "the account has no role stored afterwards").toBeNull();
  });
}
