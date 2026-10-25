/**
 * PWD-AC-002 (docs/components/password.md §4, PWD-REQ-002): "Sign-up with a password of
 * PAR-254 − 1 or PAR-255 + 1 characters gets 400 `HTTP.INVALID_INPUT`; PAR-254 and PAR-255
 * characters are accepted. The stored credential matches the PAR-244 format, and a scan of the
 * database, the log entries, the responses and the outbox finds no test password."
 *
 * The length bounds, the log entries, the responses and the outbox run in-process. The stored
 * credential and the database scan need a database the test can read: the reference app's local
 * D1 database under `dev`, with its stored log entries (`.logs/`) and captured mail (`.mail/`).
 */
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { isLocal } from "../core/support/repo.js";
import { storedEntries } from "../core/support/stores.js";
import {
  answerText,
  createVerifiedAccount,
  devMailFiles,
  disposePasswordApps,
  expectAnswer,
  expectResult,
  forgot,
  found,
  hasLink,
  httpBrowser,
  inProcessBrowser,
  linkToken,
  localDatabaseContains,
  localRows,
  localSubjectOf,
  logText,
  mailText,
  newAccount,
  openPasswordApp,
  par,
  reset,
  rowsWith,
  signIn,
  signUp,
  testIp,
  testPassword,
  waitForMail,
  type Answer,
} from "./support.js";

if (isLocal()) {
  describe("PWD-AC-002 in-process", () => {
    afterEach(disposePasswordApps);

    it(
      tag("PWD-AC-002", "sign-up with PAR-254 − 1 or PAR-255 + 1 characters is 400 HTTP.INVALID_INPUT, PAR-254 and PAR-255 characters are accepted, and no response, log entry or mail carries a test password"),
      async () => {
        const app = await openPasswordApp();
        const b = inProcessBrowser(app);
        const answers: Answer[] = [];
        const keep = (a: Answer): Answer => (answers.push(a), a);
        const min = par.minPassword();
        const max = par.maxPassword();

        const short = { ...newAccount("pwd-ac-002-short"), password: testPassword(min - 1) };
        const long = { ...newAccount("pwd-ac-002-long"), password: testPassword(max + 1) };
        const atMin = { ...newAccount("pwd-ac-002-min"), password: testPassword(min) };
        const atMax = { ...newAccount("pwd-ac-002-max"), password: testPassword(max) };
        expectAnswer(keep(await signUp(b, short, { ip: testIp() })), 400, "HTTP.INVALID_INPUT");
        expectAnswer(keep(await signUp(b, long, { ip: testIp() })), 400, "HTTP.INVALID_INPUT");
        expectResult(keep(await signUp(b, atMin, { ip: testIp() })), "check-email");
        expectResult(keep(await signUp(b, atMax, { ip: testIp() })), "check-email");
        // The refused ones created nothing that can sign in.
        expectAnswer(keep(await signIn(b, short.email, short.password, { ip: testIp() })), 400, "AUTH.LOGIN_FAILED");

        // Both accepted accounts work end to end, and a reset obeys the same bounds.
        const ip = testIp();
        for (const a of [atMin, atMax]) {
          const mail = await waitForMail(b.mail, a.email, "verification", { accept: (m) => hasLink(m, "verify") });
          expectResult(keep(await b.post("/api/auth/password/verify", { token: linkToken(mail, "verify", b.publicOrigin) }, { ip })), "verified");
          expectAnswer(keep(await signIn(b, a.email, a.password, { ip })), 200);
          b.clearCookies();
        }
        const wrong = testPassword(min + 3);
        expectAnswer(keep(await signIn(b, atMin.email, wrong, { ip: testIp() })), 400, "AUTH.LOGIN_FAILED");
        expectResult(keep(await forgot(b, atMin.email, { ip })), "check-email");
        const resetMail = await waitForMail(b.mail, atMin.email, "reset", { accept: (m) => hasLink(m, "reset") });
        const token = linkToken(resetMail, "reset", b.publicOrigin);
        const tooShort = testPassword(min - 1);
        expectAnswer(keep(await reset(b, token, tooShort, { ip })), 400, "HTTP.INVALID_INPUT");
        const renewed = testPassword(max);
        expectResult(keep(await reset(b, token, renewed, { ip })), "password-reset");

        const needles = { "short password": short.password, "long password": long.password, "minimum-length password": atMin.password, "maximum-length password": atMax.password, "wrong password": wrong, "too-short reset password": tooShort, "new password": renewed };
        expect(answers.flatMap((a) => found(answerText(a), needles).map((l) => `${a.method} ${a.path}: ${l}`)), "responses").toEqual([]);
        expect(logText(app.logs()).flatMap((line, i) => found(line, needles).map((l) => `log entry ${String(i)}: ${l}`)), "log entries").toEqual([]);
        expect((await app.mail.all()).flatMap((m, i) => found(mailText(m), needles).map((l) => `mail ${String(i)} "${m.subject}": ${l}`)), "outbox").toEqual([]);
      },
      180_000,
    );
  });

  describe("PWD-AC-002 under dev (local D1)", () => {
    it(
      tag("PWD-AC-002", "under dev: the stored credential has the PAR-244 format, and the database, the stored log entries, the responses and .mail/ hold no test password"),
      async () => {
        const b = httpBrowser();
        const a = newAccount("pwd-ac-002-dev");
        const ip = testIp();
        const answers: Answer[] = [];
        await createVerifiedAccount(b, a, ip);
        const wrong = testPassword(17);
        answers.push(expectAnswer(await signIn(b, a.email, a.password, { ip }), 200));
        answers.push(expectAnswer(await signIn(b, a.email, wrong, { ip }), 400, "AUTH.LOGIN_FAILED"));

        const subject = localSubjectOf(a.email);
        const accounts = rowsWith(localRows("__framework_auth_account"), subject);
        expect(accounts.length, "the account's credential row").toBe(1);
        const hashes = Object.values(accounts[0] ?? {}).filter((v): v is string => typeof v === "string" && par.hashFormat().test(v));
        expect(hashes.length, `a column of the credential row has the PAR-244 form <salt hex>:<key hex> (columns: ${Object.keys(accounts[0] ?? {}).join(", ")})`).toBe(1);

        const needles = { "test password": a.password, "wrong password": wrong };
        expect(localDatabaseContains(a.password), "local D1 files containing the test password").toEqual([]);
        expect(localDatabaseContains(wrong), "local D1 files containing the wrong password").toEqual([]);
        const entries = await storedEntries({ what: "PWD-AC-002" });
        expect(entries.flatMap((e) => found(e.raw, needles).map((l) => `${e.where}: ${l}`)), "stored log entries").toEqual([]);
        expect(answers.flatMap((r) => found(answerText(r), needles).map((l) => `${r.path}: ${l}`)), "responses").toEqual([]);
        expect((await devMailFiles()).flatMap((f) => found(`${f.subject}\n${f.text}\n${f.html}`, needles).map((l) => `.mail/${f.file}: ${l}`)), ".mail/").toEqual([]);
      },
      180_000,
    );
  });
}
