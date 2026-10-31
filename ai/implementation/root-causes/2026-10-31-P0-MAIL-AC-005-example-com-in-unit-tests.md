# Root cause: MAIL-AC-005: two unit tests added on 2026-10-26 use `@example.com` addresses, which are not reserved names under MAIL-AC-005's own definition

Author: diagnosing subagent for P0 (plan-v0.2.0 §7a.1.8 step 1, prompt §8 step 1). I wrote none of the files involved. This record is a diagnosis only: I changed no code, test or doc. It needs an independent review before any fix.

Base: `origin/main` at `1e0c289`. Node 22.23.4. Chromium shim per progress-v0.2.0 §6.

## Symptom
`npm run compliance -- --target local --only …,MAIL-AC-005,…` (record `y6qa0drbpq3riqs`) fails the first of MAIL-AC-005's two tests:

```
FAIL  tests/compliance/criteria/mail/mail.test.ts > MAIL-AC-005 > [MAIL-AC-005] a scan of packages/, apps/, skill/ and tests/ finds no email address whose domain is not a reserved name
AssertionError: addresses on a non-reserved domain: expected [ …(3) ] to deeply equal []
+ [
+   "packages/create-prototype-app/test/create.unit.test.ts: test@example.com",
+   "packages/create-prototype-app/test/create.unit.test.ts: test@example.com",
+   "packages/framework/src/cli/cloudflare-settings.unit.test.ts: a@example.com",
+ ]
 ❯ tests/compliance/criteria/mail/mail.test.ts:245:56
```

The second test (the stage-config schema allows only `senderName`) passes.

## Evidence
1. **The criterion** (`docs/components/mail.md:68`, MAIL-AC-005, Verifies MAIL-REQ-003, Where Local): "A repository scan of `packages/`, `apps/`, `skill/` and `tests/` … finds no email address whose domain is not a reserved name (`localhost`, or ending in `.test`, `.example` or `.invalid`)." `example.com` is not in that list. It is reserved by RFC 2606 as a second-level name, but the criterion defines "reserved name" more narrowly, as the four forms above.
2. **The test implements the criterion verbatim.** `mail.test.ts:58` `ADDRESS = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g`. `reserved()` (lines 61–64) accepts `localhost` and the suffixes `.test`, `.example`, `.invalid`. The scan is lines 232–245.
3. **The three hits:**
   - `packages/create-prototype-app/test/create.unit.test.ts:174`: `const GIT_ENV = { …, GIT_AUTHOR_EMAIL: "test@example.com", …, GIT_COMMITTER_EMAIL: "test@example.com" };` (two matches). `git blame`: `fbfcccc` (2026-10-26, "Starter tests for git and the closing line …").
   - `packages/framework/src/cli/cloudflare-settings.unit.test.ts:74`: `withCloudflareSettings("mail", load, env)(["last", "--to", "a@example.com"], io);`. `git blame`: `3394ca9` (2026-10-26, "Token sources: .env.cloudflare after the environment …"). The file did not exist at `2855407`.
4. **It was green before, and only the scanned data changed.**
   - Local record `validation/local/htth52fbl34gzk7.json` (commit `2855407`, 2026-10-25) has MAIL-AC-005 `passed`.
   - `create.unit.test.ts` at `2855407` contains no `example.com` (`git show … | grep -c` = 0).
   - Both commits in item 3 descend from `2855407` (`git merge-base --is-ancestor`).
   - `git log 2855407..1e0c289 -- tests/compliance/criteria/mail/mail.test.ts docs/components/mail.md` is empty, so neither the test nor the criterion changed.
5. **Why it went unnoticed.** Both files are unit tests (`vitest.unit.config.ts` includes `packages/framework/src/**/*.unit.test.ts` and `packages/create-prototype-app/test/**/*.unit.test.ts`), so their authors' `npm run verify` / `test:unit` passed. MAIL-AC-005 is in `tests/compliance/criteria/**` (integration layer) and runs only through the compliance driver. No local compliance record covering MAIL-AC-005 was committed after 2026-10-26.
6. **The repository's own convention elsewhere** is `.invalid`. Other test fixtures that need a git identity use `t@example.invalid` (`packages/framework/src/evidence/writer.unit.test.ts:34`), `compliance-test@example.invalid` (`tests/compliance/criteria/compl/support.ts:62`), `setup-ac@example.invalid` (`tests/compliance/criteria/setup/support/setup-runs.ts:236`) and `compliance@example.invalid` (`tests/compliance/criteria/core/support/processes.ts:120`). Mail tests use `@example.test` (`cli/commands/mail.unit.test.ts:46`).
7. **No assertion depends on the values.** In `create.unit.test.ts`, `GIT_ENV` is only spread into child environments (lines 175, 184, 188, 232). In `cloudflare-settings.unit.test.ts:74`, the address is an argument to a recorded loader whose assertion (line 75) compares only the environments.

## Causal chain (each link evidenced)
1. `fbfcccc` and `3394ca9` add three `@example.com` addresses under `packages/` (item 3).
2. `example.com` is not one of MAIL-AC-005's reserved names (item 1). The test checks exactly that rule (item 2).
3. The scan lists the three addresses, and `mail.test.ts:245` fails (Symptom). Nothing else changed since the last pass (item 4).

## Alternatives ruled out
- **The test is wrong.** Ruled out. It matches the criterion text word for word (items 1, 2) and is unchanged since it passed (item 4). Widening `reserved()` to accept `example.com` would change a once-green test's expected result against its criterion's text. That is not allowed without a spec change, and MAIL is being retired anyway.
- **The criterion is too strict.** This would be a spec question, but it is moot: MAIL-REQ-003 and MAIL-AC-005 are retired in v0.2.0 (below).
- **Flaky or environmental.** Ruled out. The result is a deterministic scan of tracked files.

## Retirement by v0.2.0
Plan-v0.2.0 §6 "Spec" retires `mail.md` and all MAIL-* criteria. Item B's PR `46-remove-mail` (progress §3, B) removes "MAIL criteria" and owns `tests/compliance/criteria/{auth,pwd,mail}/**`. That deletes `mail.test.ts`, and with it MAIL-AC-005's scan. MAIL-REQ-003 is the only place the reserved-domain rule is stated (`grep -rn "reserved name" docs` finds only mail.md:68). So once B 46 merges, nothing checks these addresses and this failure disappears.

## Proposed fix
**Recommended:** a small fix now (PR `08-fix-baseline-<slug>` ← main), because B 46 merges late in wave 1, after the wave-0 and wave-1 exit checks that rely on the baseline (progress §3 P0).
- In `packages/create-prototype-app/test/create.unit.test.ts:174`, change `test@example.com` to `test@example.invalid` (both occurrences).
- In `packages/framework/src/cli/cloudflare-settings.unit.test.ts:74`, change `a@example.com` to `a@example.invalid`.
- This follows the repository's convention (item 6). Only test data changes, and no assertion changes (item 7). The §7a.1.9 test-change reason code is `test-was-wrong`, citing this record.
- The `create.unit.test.ts` git identity survives B. Line 74 of `cloudflare-settings.unit.test.ts` exercises the `mail` command, which B removes. B must adapt that line in any case.

**Acceptable alternative:** "none: retired by B (`46-remove-mail`)". The baseline then carries MAIL-AC-005 as a known failure, with this record cited, until B 46 merges. The reviewer chooses between the two.

## Verification plan
- **Red now:** `npm run compliance -- --target local --only MAIL-AC-005` fails as in Symptom. The existing criterion test is the reproduction test.
- **Green after the fix:** the same command passes both MAIL-AC-005 tests. Also run `npx vitest run --config vitest.unit.config.ts packages/create-prototype-app/test/create.unit.test.ts packages/framework/src/cli/cloudflare-settings.unit.test.ts`, which should stay green.
- **If the alternative is chosen:** after B 46, MAIL-AC-005 no longer appears in the catalogue, and `git grep -n 'MAIL-AC-005' tests` is empty.

## Review
(pending: independent root-cause reviewer)
