# Root cause (similar case): the demo's `fromBase64url` accepts non-canonical base64url, so each share link has 4 accepted spellings

Author: T7 follow-up subagent, 2026-10-31. It did not write the code. This is a similar-case record (plan §7a.1.8 step 4). The cause, alternatives and fix are those of G's accepted record `2026-10-31-G-template-signing-noncanonical.md` (branch `v0.2.0/69-fix-template-signing`, PR #147; Review round 1: accepted). That record's Similar cases section found this case, and DEC-0742 made it a new item, because `apps/demo/**` is a one-time copy that G does not own. This record shows the same evidence holds for the demo's own file, on branch `v0.2.0/95-fix-demo-signing` (base `v0.2.0/71n-path-map-after-removals`, `60b5e8e`), Node v22.23.4, Vitest 5.0.5.

## Symptom
`verifyToken` in `apps/demo/src/server/signing.ts` accepts a token whose signature has been re-spelled in its last character. Each 43-character HMAC-SHA-256 signature has 4 accepted spellings. The demo's share links use it (`apps/demo/src/server/routes/share.ts:7,18,25`, DEMO-REQ-007), so each share link has 4 accepted forms. DEMO-AC-007 says "an altered … link is refused".

## Evidence
- **Same code as G's case.** `diff apps/template/src/server/signing.ts apps/demo/src/server/signing.ts` and `diff apps/template/tests/signing.test.ts apps/demo/tests/signing.test.ts` are both empty on this base. So `fromBase64url` (`apps/demo/src/server/signing.ts:20-28`) returns `atob(...)`'s bytes with no canonical check, as in G's record.
- **Reproduction against the demo's file.** A scratch Vitest file `apps/demo/tests/zz-scratch-respell.test.ts` imported `signToken` and `verifyToken` from `../src/server/signing`, with a generated dummy key (`dummy-<randomUUID>-<randomUUID>`). For 200 tokens (`post-0` … `post-199`) it tried all 64 values of the last signature character (alphabet index XOR 0–63). Run with `cd apps/demo && npx vitest run tests/zz-scratch-respell.test.ts --silent=false`. The file was deleted afterwards. Output:

  ```
  spelling ...dYc (flip 0) -> post-0
  spelling ...dYd (flip 1) -> post-0
  spelling ...dYe (flip 2) -> post-0
  spelling ...dYf (flip 3) -> post-0
  spelling ...dYY (flip 4) -> null
  spelling ...dYU (flip 8) -> null
  spelling ...dYM (flip 16) -> null
  spelling ...dY8 (flip 32) -> null
  signature lengths: [ [ 43, 200 ] ] last-char low 2 bits: [ [ 0, 200 ] ] accepted spellings per token: [ [ 4, 200 ] ]
   Tests  1 passed (1)
  ```

- **`signToken` emits only the canonical spelling.** For 200 of 200 tokens the low 2 bits of the last character's index were 0 (above). So a canonical check rejects no link the demo issued.
- **Experiment confirming the cause.** As an uncommitted change, `apps/demo/src/server/signing.ts` was replaced by the fixed template file from branch 69 (`fromBase64url` returns `toBase64url(bytes) === text ? bytes : null`). Then `npx vitest run tests/zz-scratch-respell.test.ts tests/signing.test.ts` gave `AssertionError: expected [ [ 1, 200 ] ] to deeply equal [ [ 4, 200 ] ]` for the probe (only the issued spelling verifies), and `3 passed` for the demo's existing signing tests. It was reverted with `git checkout apps/demo/src/server/signing.ts`.
- **One-time copy, no owner.** `apps/demo/BUILD-RECORD.md:7` says the demo was rebuilt by copying `apps/template`. No script, scaffold or `npm create` step regenerates it (G's record, Similar cases, confirmed by its Review), so G's template fix (#147) does not reach the demo.

## Causal chain
1. `verifyToken` decodes the signature with `fromBase64url` and passes the bytes to `crypto.subtle.verify`. Evidence: `apps/demo/src/server/signing.ts:42-44`, identical to the template's (empty `diff`).
2. `fromBase64url` maps the 4 spellings that differ only in the last character's 2 unused low bits to the same 32 bytes (`atob`, WHATWG forgiving-base64, drops those bits). Evidence: flips 0–3 verify, flips 4–32 do not.
3. So all 4 spellings of each 43-character demo signature verify. Evidence: `accepted spellings per token: [ [ 4, 200 ] ]`.
4. A canonical re-encode check removes the extra spellings and breaks no existing demo signing test. Evidence: the experiment (`[ [ 1, 200 ] ]`; `3 passed`).

## Alternatives ruled out
As in G's record, which ruled them out with evidence; the code is byte-identical:
- **Forgery or a key problem:** the 4 spellings decode to the same bytes, which `crypto.subtle.verify` checks against the real key; flips 4–32 are refused.
- **Malleable subject or expiry:** they are signed as text. The demo's existing test "refuses a tampered token, another key, and malformed input" passes, and it covers a changed subject and expiry+1.
- **Already fixed by G's template fix:** no. The demo is a one-time copy (Evidence), and on this base its `fromBase64url` has no canonical check.
- **Runtime differences (`atob` in Node vs workerd):** both follow WHATWG forgiving-base64; the fix is a check in the demo's own code, independent of the runtime.

## Proposed fix
- **`apps/demo/src/server/signing.ts`:** the same change as G's fix in #147. `fromBase64url` returns the bytes only when `toBase64url(bytes) === text`; this is the rule of the framework's `auth/signing.ts` `base64urlDecode`.
- **Red test in `apps/demo/tests/signing.test.ts`:** the same test as G's: "accepts only the issued spelling of a signature, not one re-spelled in its last character". It checks the issued 43-character signature has its 2 unused low bits at zero, refuses the 3 other spellings, and still accepts the issued token.
- **`skill/examples/secrets.md`:** no change. `tests/skill/example-copies.test.ts` exempts a block that equals a demo file only when it also equals its template source. After this fix the demo copies equal G's fixed template files, so SKILL-AC-004 holds in either merge order of #147 and this PR.

## Verification plan
- **Red.** Add the test without the source fix: `cd apps/demo && npx vitest run tests/signing.test.ts`. Expected: the new test fails (a re-spelled signature returns the subject); the 3 existing tests pass.
- **Green.** Apply the fix. Expected: 4 passed. Then the demo's own tests (`npx vitest run` in `apps/demo`), and from the root `npm run build -w packages/framework && npm run typecheck && npm run lint && npm run test:unit`, and `npx vitest run --config vitest.integration.config.ts tests/skill/example-copies.test.ts`. CI on the PR.

## Similar cases
`grep -rn "atob(" apps skill --include=*.ts` on this base: `apps/template/src/server/signing.ts:24` (G's, fixed in #147), `apps/demo/src/server/signing.ts:24` (this record), and `apps/reference/src/server/encoding.ts:10`, which decodes upload content, not a signature or identity (excluded in G's record and its Review). `skill/examples/secrets.md` copies the template, which #147 fixes. No other case.

## Review
Status: awaiting review
