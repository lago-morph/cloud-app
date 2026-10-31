# Root cause: `sanitizeReturnTo` keeps `/%09/evil.example` (and `%0A`, `%0D`): its decoded-path check misses the tab and newline that URL parsers strip, so one more percent-decode yields a cross-origin URL

Author: item T4 (diagnosis, plan §7a.1.8 step 1), 2026-10-31. Found by fuzz target F1 (S4, `ai/implementation/v0.2.0-coverage-fuzz.md` §2) on branch `v0.2.0/88-fuzz-targets` at `07922db` (based on `v0.2.0/55-merge-auth-app-into-bootstrap`, PR #94). Item T4 is the implementer and also the diagnoser; no separate diagnoser subagent was available (see "Process").

## Symptom
`npx vitest run --config vitest.unit.config.ts packages/framework/src/auth/return-to.fuzz.unit.test.ts` (Node v22.23.4):

```
× F1: sanitizeReturnTo … keeps only same-origin paths, also after one more percent-decode (1000 runs, seed 2026103101)
  Property failed after 270 tests  { seed: 2026103101, path: "269:2:2:2:2:2:2", endOnFailure: true }
  Counterexample: ["/%0a/","https://a.aa"]   Shrunk 6 time(s)
  Caused by: TypeError: Invalid URL   (new URL(decodeURIComponent(out), origin), input '/\n/')
```

The property is S4's: for any input the result is `/` or the input unchanged, and it "resolves to the same origin against any https origin, also after one more percent-decode".

## Evidence
- **Reproduction** (the script in the Appendix, against `packages/framework/dist` built from `07922db`), base `https://app.example`:

  ```
  "/%0a/"               -> "/%0a/"               raw resolves https://app.example  decoded "/\n/"             resolves throws ERR_INVALID_URL
  "/%09/evil.example"   -> "/%09/evil.example"   raw resolves https://app.example  decoded "/\t/evil.example" resolves https://evil.example
  "/%0A/evil.example"   -> "/%0A/evil.example"   raw resolves https://app.example  decoded "/\n/evil.example" resolves https://evil.example
  "/%0D/evil.example"   -> "/%0D/evil.example"   raw resolves https://app.example  decoded "/\r/evil.example" resolves https://evil.example
  "/%09%2Fevil.example" -> "/%09%2Fevil.example" raw resolves https://app.example  decoded "/\t/evil.example" resolves https://evil.example
  "/%09%5Cevil.example" -> "/%09%5Cevil.example" raw resolves https://app.example  decoded "/\t\\evil.example" resolves https://evil.example
  "/%2F%2Fevil.example" -> "/"                   (refused today: decoded starts with "//")
  "/%20/evil.example"   -> "/%20/evil.example"   decoded "/ /evil.example" resolves https://app.example (space is kept)
  "/a%09b"              -> "/a%09b"              decoded "/a\tb" resolves https://app.example
  WHATWG strips tab/LF/CR anywhere: new URL("/\t/evil.example", base).href = https://evil.example/
  ```
- **The rule as written** (`auth/return-to.ts:1-7`, `:19-21`): "neither the raw nor the decoded path starts with `//` or `/\`". The raw value is checked against `SAFE_CHARS` (`\x21`–`\x7e`), so a raw tab or newline is refused. The *decoded* value is only tested with `startsWith("//")` and `startsWith("/\\")`. The last check (`new URL(value, base).origin !== base`) resolves only the raw value.
- **The URL parser removes ASCII tab, LF and CR anywhere in the input** before parsing (WHATWG URL, "basic URL parser", step 3), so the decoded `/\t/evil.example` parses as `//evil.example`. Shown by the last line above.
- **The intent covers this class:** `return-to.unit.test.ts` refuses `/%2F%2Fevil.example`, `/%2f%5Cevil.example` and `/%5C%5Cevil.example` *because of their decoded form*. `/%09/evil.example` is the same class with a stripped character between the two slashes.
- **Reach today:** the sanitised value is used as `Location` unchanged (`auth/runtime.ts:268`, `:301`; Hono's `c.redirect` writes the string as-is when it is Latin-1), and the browser resolves the raw value, which stays same-origin. No current hop decodes it once more (`grep -rn "decodeURI" packages/framework/src/auth` finds only `return-to.ts`). So this is a gap in a defence-in-depth clause, not an open redirect reachable today. v0.2.0 adds a second redirect hop (S4 F1 evidence), which is why the clause exists.

## Causal chain
1. `sanitizeReturnTo` decodes the value once and refuses it if the decoded path starts with `//` or `/\`. Shown by `return-to.ts:15-21`.
2. A decoded path can start with `/`, then a tab, LF or CR, then `/` or `\`. It passes link 1's test, because the second character is the control character. Shown by `/%09/evil.example` being kept.
3. The URL parser strips that character, so the decoded path parses as scheme-relative and leaves the origin. Shown by `new URL("/\t/evil.example", base)` = `https://evil.example/`, and by the F1 counterexample (`/\n/` is an invalid scheme-relative URL).
4. The final origin check resolves only the raw value, which stays same-origin, so nothing catches link 3. Shown by "raw resolves https://app.example" on each line.

## Alternatives ruled out
- **The property is too strong:** it is S4's, confirmed by the S4 reviewer. The module's own comment and unit tests already require the decoded form to be safe (link 1, Evidence), and `/%09/evil.example` is the same class as `/%2F%2Fevil.example`.
- **The decoded form should simply be refused for any control or space character:** that would also refuse legitimate same-origin paths such as `/search?q=a%20b` or `/a%09b`, which decode to strings that still resolve same-origin. The defect is only the origin-changing case.
- **Other characters the parser strips or folds:** leading and trailing C0 controls and spaces are trimmed, but the decoded value always starts with `/` (the raw one must), so leading trimming cannot apply, and trailing trimming cannot change the origin. Backslash is already handled (`/\` and `%5C`). The fuzz generator mixes `/ \ %2f %5c %09 %0a %0d @ :` and found only the tab/LF/CR case.

## Proposed fix
In `packages/framework/src/auth/return-to.ts`, the final origin check resolves both forms: `for (const path of [value, decoded]) if (!URL.canParse(path, base) || new URL(path, base).origin !== base) return "/";`. This states the rule directly ("the decoded path must stay same-origin, too"), covers the stripped characters without listing them, and keeps every value the current tests keep. The module comment is updated to match.

Files: `packages/framework/src/auth/return-to.ts`; the shrunk counterexample and the three hostile values become plain regression cases in `packages/framework/src/auth/return-to.unit.test.ts` (plan §7a.1.7).

**Experiment:** with that change (uncommitted, reverted after), `vitest run` over `packages/framework/src/{auth,files,kv}` passed (50 files, 596 tests, run together with the F4 fix experiment), including F1 and the existing AUTH-AC-010 tests.

## Similar cases (plan §7a.1.8 step 4)
Search: `grep -rn 'startsWith("//")\|decodeURIComponent(' packages apps skill --include=*.ts`.
- **The auth app's `return` check** (`auth-app/store.ts` `isRegistered`) is an exact string match against canonical registered URLs (`validReturnUrl` requires `new URL(url).href === url`, which excludes tab and newline). F2 covers it and passes.
- **`auth/client.ts` `login(returnTo)`** only builds the query; the server sanitises it.
- **`auth/password/routes.ts`** calls the same `sanitizeReturnTo`, so the fix covers it.
- The other `decodeURIComponent` call sites are object-key decoding in tests and fakes (`provision/cloudflare/fake-cloud.test-support.ts`, `files/s3/sigv4-reference.test-support.ts`) and `provision/cloudflare/api.ts:61` (path segments of Cloudflare API calls built by the framework). None of them decides a redirect target.
- No similar case outside T4's owned paths.

## Verification plan
- **Red (on `88` and `89`):** F1 fails with the counterexample above. `sanitizeReturnTo("/%09/evil.example")` returns the input.
- **Green (on `89b`):** F1 and the new `return-to.unit.test.ts` cases pass. The existing AUTH-AC-010 cases (`return-to.unit.test.ts`, `test/integration/auth/login-flow.test.ts`'s fixed values) still pass. `npm run build -w packages/framework && npm run typecheck && npm run lint && npm run test:unit` passes.
- **CI:** the unit job on `89b` passes.

## Process
Item T4 had no subagent tool, so it diagnosed its own finding. The review is by a fresh, independent Claude Code remote session that did not write the test or the code (plan §7a.1.8 step 2). Disclosure: T4's first F1 generator mixed the special pieces too thinly and passed 1,000 runs. A hand probe of `/%09/evil.example` showed the failure first. The generator was then focused on separator runs after the leading `/`, using the characters S4's property names. Only after that did the fuzz test find `/%0a/` on its own at run 270.

## Review
Reviewer: an independent Claude Code remote session (`session_014mWQ6iUAmPMoYo2DWNgSsL`), 2026-10-31, round 1, read-only, on commit `f5de06d`. It reproduced the F1 failure (`["/%0a/","https://a.aa"]`) and every line of the Appendix. It then applied the proposed fix as an uncommitted experiment and reverted it. With the fix, F1 passed at the fixed seed and at seeds 1–3 with 20,000 runs, and the existing AUTH-AC-010 unit tests still passed.

**Verdict: accepted.**
1. **minor:** The chain is supported:
   - `/%09/evil.example` is kept, and its raw value resolves same-origin;
   - its decoded value resolves to `https://evil.example`, because WHATWG strips tab, LF and CR;
   - link 1 matches the decoded `startsWith` checks, and link 4 the raw-only origin check.
2. **minor:** The fix is right and minimal. It states the rule directly and also refuses `/\n/`, which throws. The "too broad" alternative is correctly rejected: `/a%09b` and `/%20/…` are still kept.
3. **minor:** The F1 property has all four of S4's clauses. The generator was focused after the hand probe, the record discloses this, and the generator's pieces stay within S4's list.
4. **minor:** The similar-case search is adequate. `startsWith("//")` occurs only in `return-to.ts`, and `returnTo` appears nowhere in `apps` or `skill`. "Reach today" matches `runtime.ts:256, 268, 301`.
5. **minor:** When fixing, update the module comment (`return-to.ts:1-7`) to say the decoded path must also resolve same-origin.

## Response (round 1)
- **To 5.** Done in the fix commit: the module comment now says that both the raw and the decoded path must resolve same-origin.
- **Nothing else changes.** The fix follows the record.

**Status:** accepted.

## Appendix: reproduction script
Run as `D=$PWD/packages/framework/dist node repro.mjs` from the repo root, after `npm run build -w packages/framework`.

```js
const { sanitizeReturnTo } = await import(`${process.env.D}/auth/return-to.js`);
const O = "https://app.example";
const resolve = (p) => {
  try { return new URL(p, O).origin; } catch (e) { return `throws ${e.code}`; }
};
for (const v of ["/%0a/", "/%09/evil.example", "/%0A/evil.example", "/%0D/evil.example", "/%09%2Fevil.example", "/%09%5Cevil.example", "/%2F%2Fevil.example", "/%20/evil.example", "/a%09b", "/%09"]) {
  const out = sanitizeReturnTo(v);
  const dec = decodeURIComponent(out);
  console.log(JSON.stringify(v), "->", JSON.stringify(out), "raw resolves", resolve(out), "decoded", JSON.stringify(dec), "resolves", resolve(dec));
}
console.log("WHATWG strips tab/LF/CR anywhere:", new URL("/\t/evil.example", O).href, "|", new URL("/\n\r/evil.example", O).href, "| space kept:", new URL("/ /x", O).href);
```
