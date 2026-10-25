/**
 * MAIL-AC-001…MAIL-AC-005 (docs/components/mail.md §4), the local criteria of outgoing mail.
 *
 * - MAIL-AC-001, -002: in-process (`createTestApp` with `passwordLoginProvider`, the outbox
 *   `TestApp.mail`, and the `mailSender` variants of testing.d.ts).
 * - MAIL-AC-003: the run's `dev` server writes `.mail/`; `mail last` reads it; `reset-local`
 *   (in a scratch copy, so the run's own state is untouched) clears it.
 * - MAIL-AC-004: local Cloudflare builds of a scratch copy of the reference app, inspected for
 *   the test-stage mail capture's route.
 * - MAIL-AC-005: the repository scan for an address on a non-reserved domain, and the stage-config
 *   contract's `framework.email` (the build's own refusal is in config/email-schema.test.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tag, waitFor } from "../../harness/index.js";
import { cli, listFiles, runCommand, scratchCopy } from "../core/support/processes.js";
import { DOCS, isLocal, REFERENCE_DIR, REPO_ROOT, uniqueValue } from "../core/support/repo.js";
import {
  comparable,
  devMailFiles,
  disposePasswordApps,
  expectAnswer,
  expectResult,
  forgot,
  found,
  hasLink,
  httpBrowser,
  IN_PROCESS_ORIGIN,
  IN_PROCESS_SECRET,
  inProcessBrowser,
  linkToken,
  mailCountAfter,
  mailText,
  me,
  newAccount,
  openPasswordApp,
  resend,
  signIn,
  signUp,
  testIp,
  verify,
  waitForMail,
  type Answer,
  type AuthBrowser,
  type LogEntry,
} from "../pwd/support.js";

const FORGED_HOST = {
  host: "evil.example",
  "x-forwarded-host": "evil.example",
  "x-forwarded-proto": "https",
  forwarded: "host=evil.example;proto=https",
};

/** The address shape the MAIL-AC-005 scan looks for; group 1 is the domain. */
const ADDRESS = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g;

/** MAIL-AC-005's reserved names: `localhost`, or ending in `.test`, `.example` or `.invalid`. */
function reserved(domain: string): boolean {
  const d = domain.toLowerCase();
  return d === "localhost" || d.endsWith(".test") || d.endsWith(".example") || d.endsWith(".invalid");
}

if (isLocal()) {
  describe("MAIL in-process", () => {
    afterEach(disposePasswordApps);

    it(
      tag("MAIL-AC-001", "a sign-up with a forged Host puts one message in the outbox whose links are on the public origin, with the display name and no password, secret or user ID"),
      async () => {
        const b = inProcessBrowser(await openPasswordApp());
        const a = newAccount("mail-ac-001");
        const ip = testIp();
        expectResult(await signUp(b, a, { ip, headers: FORGED_HOST }), "check-email");
        const message = await waitForMail(b.mail, a.email, "verification", { accept: (m) => hasLink(m, "verify") });
        expect(await mailCountAfter(b.mail, a.email), "one message").toBe(1);
        expect(message.to.toLowerCase()).toContain(a.email.toLowerCase());
        const token = linkToken(message, "verify", IN_PROCESS_ORIGIN); // every link on the public origin
        expect(mailText(message), "no forged host in the message").not.toContain("evil.example");
        expect(mailText(message), "the display name the person entered").toContain(a.displayName);

        // The user ID exists once the account signs in; the message must not have carried it.
        expectResult(await verify(b, token, { ip }), "verified");
        expectAnswer(await signIn(b, a.email, a.password, { ip }), 200);
        const id = (await me(b)).id ?? "";
        expect(id).not.toBe("");
        expect(found(mailText(message), { password: a.password, "the reference app's secret": IN_PROCESS_SECRET, "user ID": id }), "the message").toEqual([]);
      },
      120_000,
    );

    it(tag("MAIL-AC-001", "with a sender that never completes, the sign-up response still arrives"), async () => {
      const b = inProcessBrowser(await openPasswordApp({ mailSender: "never-completing" }));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("no sign-up response within 15 s while the send never completes")), 15_000)));
      try {
        expectResult(await Promise.race([signUp(b, newAccount("mail-ac-001-stuck"), { ip: testIp() }), timeout]), "check-email");
      } finally {
        clearTimeout(timer);
      }
    });

    it(
      tag("MAIL-AC-002", "with a sender whose every send fails, sign-up, forgot and resend answer exactly as with a working sender, and each failed send writes one MAIL entry naming the code and no address"),
      async () => {
        const run = async (b: AuthBrowser, email: string): Promise<Answer[]> => {
          const a = { ...newAccount("mail-ac-002"), email, password: "Mail-ac-002-password", displayName: "MAIL-AC-002" };
          const ip = "10.20.30.40";
          return [await signUp(b, a, { ip }), await forgot(b, email, { ip }), await resend(b, email, { ip }), await signUp(b, a, { ip, form: true })];
        };
        const working = inProcessBrowser(await openPasswordApp());
        const failingApp = await openPasswordApp({ mailSender: "failing" });
        const failing = inProcessBrowser(failingApp);
        const email = newAccount("mail-ac-002").email;
        const good = await run(working, email);
        const bad = await run(failing, email);
        for (const [i, what] of ["sign-up", "forgot", "resend", "sign-up again (303 form)"].entries()) {
          const g = good[i];
          const f = bad[i];
          if (g === undefined || f === undefined) throw new Error("missing answer");
          expect(comparable(f), `${what}: failing sender vs working sender`).toStrictEqual(comparable(g));
        }
        // Sends: the verification (sign-up), the reset (forgot), the verification (resend), the notice (second sign-up).
        const mailEntries = await waitFor(
          async () => {
            const entries = failingApp.logs().filter((e: LogEntry) => e.component === "MAIL");
            return entries.length >= 4 ? entries : undefined;
          },
          { what: "four MAIL log entries for the failed sends", timeoutMs: 20_000, intervalMs: 200 },
        );
        await new Promise((r) => setTimeout(r, 1_000));
        const all = failingApp.logs().filter((e: LogEntry) => e.component === "MAIL");
        expect(all.length, `one entry per failed send: ${JSON.stringify(all)}`).toBe(4);
        for (const e of mailEntries) {
          expect(e.severity).toBe("error");
          expect(e.message, "mail send failed: <code>").toMatch(/^mail send failed: [A-Za-z0-9_.-]+$/);
          expect(found(JSON.stringify(e), { "test address": email, "address local part": email.split("@")[0] ?? email }), "the entry").toEqual([]);
        }
      },
      120_000,
    );
  });

  describe("MAIL under dev", () => {
    it(
      tag("MAIL-AC-003", "under dev a sign-up writes one .mail/<timestamp>-<id>.json, .mail/ is git-ignored, and mail last --to prints that message"),
      async () => {
        const b = httpBrowser();
        const a = newAccount("mail-ac-003");
        const before = new Set((await devMailFiles()).map((f) => f.file));
        expectResult(await signUp(b, a, { ip: testIp() }), "check-email");
        await waitForMail(b.mail, a.email, "verification");
        await mailCountAfter(b.mail, a.email, 1_000);
        const mine = (await devMailFiles()).filter((f) => !before.has(f.file) && f.to.toLowerCase().includes(a.email.toLowerCase()));
        expect(mine.length, "one new .mail/ file for the sign-up").toBe(1);
        const file = mine[0];
        if (file === undefined) return;
        expect(file.file, ".mail/<timestamp>-<id>.json").toMatch(/^[0-9][^/]*-[^/]+\.json$/);
        const raw = JSON.parse(readFileSync(join(REFERENCE_DIR, ".mail", file.file), "utf8")) as Record<string, unknown>;
        expect(Object.keys(raw).sort(), "{ to, subject, text, html, time }").toStrictEqual(["html", "subject", "text", "time", "to"]);
        expect(Number.isNaN(Date.parse(String(raw["time"])))).toBe(false);
        expect(hasLink({ to: file.to, from: "", subject: file.subject, text: file.text, html: file.html, sentAt: file.time }, "verify")).toBe(true);

        for (const dir of [REFERENCE_DIR, join(REPO_ROOT, "apps", "template")]) {
          const ignored = await runCommand("git", ["check-ignore", "-q", join(dir, ".mail", file.file)], { cwd: REPO_ROOT, timeoutMs: 30_000 });
          expect(ignored.status, `${dir}/.mail/ is git-ignored`).toBe(0);
        }

        const last = await cli(["mail", "last", "--to", a.email], { cwd: REFERENCE_DIR, timeoutMs: 120_000 });
        expect(last.status, last.output).toBe(0);
        const json = last.output.slice(last.output.indexOf("{"), last.output.lastIndexOf("}") + 1);
        const printed = JSON.parse(json) as Record<string, unknown>;
        expect(printed, "mail last prints that message").toMatchObject({ subject: file.subject, text: file.text });
        expect(String(printed["to"]).toLowerCase()).toContain(a.email.toLowerCase());

        const none = await cli(["mail", "last", "--to", newAccount("mail-ac-003-none").email], { cwd: REFERENCE_DIR, timeoutMs: 120_000 });
        expect(none.status, `mail last for an address with no mail exits 1: ${none.output}`).toBe(1);
      },
      300_000,
    );

    it(tag("MAIL-AC-003", "reset-local clears .mail/"), async () => {
      const copy = await scratchCopy(REFERENCE_DIR, "mail-ac-003-reset");
      try {
        await mkdir(join(copy.dir, ".mail"), { recursive: true });
        await writeFile(join(copy.dir, ".mail", "2026-01-01T00-00-00Z-x.json"), JSON.stringify({ to: "a@example.test", subject: "s", text: "t", html: "h", time: "2026-01-01T00:00:00Z" }));
        const r = await cli(["reset-local"], { cwd: copy.dir, timeoutMs: 120_000 });
        expect(r.status, r.output).toBe(0);
        const left = existsSync(join(copy.dir, ".mail")) ? await readdir(join(copy.dir, ".mail")) : [];
        expect(left, "files left in .mail/").toEqual([]);
      } finally {
        await copy.remove();
      }
    });
  });

  describe("MAIL builds", () => {
    it(
      tag("MAIL-AC-004", "Cloudflare builds for prod, prodcheck and mytest-1 contain no test-mail route or capture sender; a test-<id> build contains them"),
      async () => {
        const copy = await scratchCopy(REFERENCE_DIR, "mail-ac-004");
        try {
          const testValues = await copy.read("config/cloudflare/test.json");
          const texts = new Map<string, string>();
          for (const stage of ["prod", "prodcheck", "mytest-1", `test-${uniqueValue("m").slice(0, 10)}`]) {
            if (!stage.startsWith("test-")) await copy.write(`config/cloudflare/${stage}.json`, testValues);
            const built = await cli(["build", "--target", "cloudflare", "--stage", stage], { cwd: copy.dir, timeoutMs: 300_000 });
            expect(built.status, `build --stage ${stage}: ${built.output.slice(-4000)}`).toBe(0);
            const out = join(copy.dir, ".framework", "cloudflare");
            const parts: string[] = [];
            for (const f of await listFiles(out)) if ((await stat(f)).size < 50_000_000) parts.push(await readFile(f, "utf8"));
            const text = parts.join("\n");
            expect(text, `stage ${stage}: the inspected output is a Worker bundle with the framework's routes`).toMatch(/__framework\/health/);
            texts.set(stage, text);
          }
          for (const [stage, text] of texts) {
            const hasRoute = /__framework\/test-mail/.test(text);
            expect(hasRoute, `stage ${stage}: the test-mail route ${stage.startsWith("test-") ? "is" : "is not"} in the build`).toBe(stage.startsWith("test-"));
          }
        } finally {
          await copy.remove();
        }
      },
      900_000,
    );
  });
}

describe("MAIL-AC-005", () => {
  it(tag("MAIL-AC-005", "a scan of packages/, apps/, skill/ and tests/ finds no email address whose domain is not a reserved name"), async () => {
    const listed = await runCommand("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "packages", "apps", "skill", "tests"], { cwd: REPO_ROOT, timeoutMs: 120_000 });
    expect(listed.status, listed.output.slice(0, 2000)).toBe(0);
    const files = listed.output.split("\0").filter((f) => f !== "" && !/(^|\/)(node_modules|dist|\.framework|\.wrangler|test-results|playwright-report)\//.test(f));
    expect(files.length, "the scan reads the repository").toBeGreaterThan(100);
    const hits: string[] = [];
    for (const f of files) {
      const path = join(REPO_ROOT, f);
      if (!existsSync(path) || (await stat(path)).size > 5_000_000) continue;
      const bytes = await readFile(path);
      if (bytes.includes(0)) continue; // binary
      for (const m of bytes.toString("utf8").matchAll(ADDRESS)) if (!reserved(m[1] ?? "")) hits.push(`${f}: ${m[0]}`);
    }
    expect(hits, "addresses on a non-reserved domain").toEqual([]);
  });

  it(tag("MAIL-AC-005", "the stage-config schema allows only senderName in framework.email"), () => {
    const schema = JSON.parse(readFileSync(join(DOCS, "contracts", "schemas", "stage-config.schema.json"), "utf8")) as {
      properties?: { framework?: { properties?: Record<string, { additionalProperties?: unknown; properties?: Record<string, unknown> }> } };
    };
    const email = schema.properties?.framework?.properties?.["email"];
    expect(email, "framework.email is in the contract").toBeDefined();
    expect(email?.additionalProperties, "framework.email rejects any other field").toBe(false);
    expect(Object.keys(email?.properties ?? {})).toStrictEqual(["senderName"]);
  });
});
