# Root cause: the app template's `fromBase64url` accepts non-canonical base64url, so each share-link signature has 4 accepted spellings

Author: diagnoser subagent for item G (plan §7a.1.8 step 1), 2026-10-31. It did not write the code. Found by item T4's similar-case search; T4's evidence stub is `2026-10-31-T4-template-signing-noncanonical.md` on branch `v0.2.0/89-fix-files-base64url-noncanonical`. The framework fix for the same class of defect is `2026-10-31-T4-files-base64url-noncanonical.md` on the same branch. Diagnosed on branch `v0.2.0/69-fix-template-signing` at `67fa146`, Node v22.23.4, Vitest 5.0.5.

## Symptom
`verifyToken` in `apps/template/src/server/signing.ts` accepts a token whose signature has been re-spelled in its last character. Each 43-character HMAC-SHA-256 signature has 4 accepted spellings, so each share link has 4 accepted forms. The framework's own decoders (`auth/signing.ts`, `kv/cursor.ts`, and `files/base64url.ts` after PR 89) accept one.

## Evidence
- **Reproduction against the real file.** A scratch Vitest file in `apps/template/tests/` imported `signToken` and `verifyToken` from `../src/server/signing`, with a generated dummy key (`dummy-<randomUUID>-<randomUUID>`). It signed `note-0.<now+60s>` and replaced the last signature character by the alphabet index XOR `flip`. Run with `cd apps/template && npx vitest run tests/zz-scratch-respell.test.ts --silent=false`. The file was deleted afterwards. Output:

  ```
  spelling ...dQY (flip 0) -> note-0
  spelling ...dQZ (flip 1) -> note-0
  spelling ...dQa (flip 2) -> note-0
  spelling ...dQb (flip 3) -> note-0
  spelling ...dQc (flip 4) -> null
  spelling ...dQQ (flip 8) -> null
  spelling ...dQI (flip 16) -> null
  spelling ...dQ4 (flip 32) -> null
  ```

  The same file asserted, for 200 tokens (`note-0` … `note-199`), that exactly 4 spellings (flips 0–3) verify. It passed:

  ```
  signature lengths over 200 tokens: [ [ 43, 200 ] ]
  canonical: last char index low 2 bits over 200 tokens: [ [ 0, 200 ] ]
   ✓ tests/zz-scratch-respell.test.ts > scratch > probe 139ms
  ```

- **Which positions are affected.** Only the last character, and only its low 2 bits. An HMAC-SHA-256 signature is 32 bytes = 256 bits. Base64url needs 43 characters (258 bits), so 2 bits of the last character are unused. Flipping bit 2 or higher of the last character (flips 4, 8, 16, 32 above) changes the decoded bytes, and verification fails. Every signature `signToken` produces is 43 characters long, because the key and the hash are fixed. So every token has exactly 4 spellings. (A length with `length % 4 === 2` would have 4 unused bits and 16 spellings. `signToken` never produces one.)
- **The decoder.** `fromBase64url` (`signing.ts:20-28`) checks the alphabet, maps `-_` to `+/`, pads with `=` and returns `atob(...)`'s bytes. It never re-encodes the bytes to compare them with the input. `atob` (WHATWG forgiving-base64) discards the unused bits of the last character.
- **The subject and expiry are not malleable.** `verifyToken` verifies the HMAC over the *text* `${subject}.${expires}` (`signing.ts:44`). Changing that text changes the signed data. From the same run:

  ```
  subject respelled note-0 -> note-0 with trailing char changed: null   (subject note-1)
  expiry with leading zero: null                                         (0<expires>)
  expiry +1: null
  ```

  The signature's other malformed forms are refused too: `signature with = padding: null` (the alphabet check refuses `=`), `signature truncated by 1: null`, `signature + 'A': null`.
- **No forgery.** The 4 spellings decode to the same 32 bytes, and `crypto.subtle.verify` checks those bytes against the real key. A different signature (flip ≥ 4) or another key is refused. The existing test `refuses a tampered token, another key, and malformed input` passes. The defect is malleability: one link has 4 accepted forms.
- **`signToken` always emits the canonical spelling.** It encodes with `toBase64url` (`btoa`, which writes the unused bits as zero). Over 200 tokens, the low 2 bits of the last character's alphabet index were 0 every time (the `canonical` line above). So a fix that accepts only the canonical spelling rejects no token that `signToken` issued.
- **Experiment confirming the cause.** As an uncommitted change, `fromBase64url` was changed to return `toBase64url(bytes) === text ? bytes : null` (the rule of the framework's `auth/signing.ts` `base64urlDecode`). Then:
  - `cd apps/template && npx vitest run tests/signing.test.ts`: `Test Files 1 passed (1)`, `Tests 3 passed (3)`.
  - The scratch probe failed at its "4 spellings verify" assertion: `AssertionError: expected 1 to be 4`. Only the issued spelling verified.
  - The change was reverted with `git checkout src/server/signing.ts`, and `git status` was clean.

## Causal chain
1. `verifyToken` decodes the signature part with `fromBase64url` and passes the bytes to `crypto.subtle.verify`. Evidence: `signing.ts:42-44`.
2. `fromBase64url` maps every spelling whose last character differs only in its 2 unused low bits to the same 32 bytes, because it returns `atob`'s output without a canonical check. Evidence: `signing.ts:20-28`; flips 0–3 verify, flips 4–32 do not.
3. So all 4 spellings of each 43-character signature verify, and nothing else does. Evidence: the reproduction output and the 200-token assertion.
4. Only the signature is malleable. The subject and expiry are signed as text. Evidence: the subject, leading-zero expiry and expiry+1 lines return `null`.
5. A canonical check in `fromBase64url` removes the extra spellings and breaks no existing template test. Evidence: the experiment (`expected 1 to be 4`; `tests/signing.test.ts` 3 passed).

## Alternatives ruled out
- **A forgery or key problem:** every accepted spelling decodes to the same signature bytes, which `crypto.subtle.verify` checks against the real key. Another key and a changed signature byte are refused (`tests/signing.test.ts`, and flips 4–32).
- **A malleable subject or expiry:** they are signed as text (causal link 4). A leading zero in the expiry is refused.
- **`atob` differs between Node and workerd:** both implement WHATWG forgiving-base64, which discards the unused bits. The reproduction is in Node, where the template's unit tests run. A canonical check in the template's own code is independent of the runtime.
- **The issued tokens are already non-canonical:** `signToken` uses `btoa`, which writes zero bits. 200 of 200 tokens had zero low bits.
- **Padding or other characters:** `=`, a missing character and an extra character are refused (Evidence).

## Proposed fix
- **`apps/template/src/server/signing.ts`.** `fromBase64url` returns the bytes only when they re-encode to the input:

  ```ts
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  return toBase64url(bytes) === text ? bytes : null;
  ```

  This is the rule of `packages/framework/src/auth/signing.ts` `base64urlDecode` and of `files/base64url.ts` after PR 89. No caller changes: `signToken` emits only canonical signatures, so no issued link stops working.
- **`skill/examples/secrets.md`.** It copies `apps/template/src/server/signing.ts` (marker at line 97) and `apps/template/tests/signing.test.ts` (marker at line 149) byte for byte. `tests/skill/example-copies.test.ts` (SKILL-AC-004) fails CI if a block differs from its source. So the fix must update both blocks in the same change.
- **The red test**, in `apps/template/tests/signing.test.ts`: "a signature re-spelled in its last character is refused". It signs a token, then, for each of the 3 other spellings (the last character's alphabet index XOR 1, 2 and 3), expects `verifyToken` to return `null`, and checks that the issued spelling still returns the subject. It is the plain regression test for the shrunk case (plan §7a.1.7).
- **`apps/demo/src/server/signing.ts`** is a separate case (see Similar cases). It is not part of this fix unless the orchestrator assigns it.

## Verification plan
- **Red.** Add the regression test to `apps/template/tests/signing.test.ts` (and its copy in `skill/examples/secrets.md`) without the source fix. Run `cd apps/template && npx vitest run tests/signing.test.ts`. Expected: the new test fails, because `verifyToken` returns the subject for the re-spelled signatures. The other 3 tests pass.
- **Green.** Apply the fix to `signing.ts` and its copy in `secrets.md`. Expected: `npx vitest run tests/signing.test.ts` gives 4 passed (the experiment above gave 3 passed for the existing tests).
- **Wider checks.** `npm run build -w packages/framework`, then the template's `verify` (`npm run verify -w apps/template`), and `npx vitest run tests/skill/example-copies.test.ts` from the repository root (SKILL-AC-004: the copies in `secrets.md` match). CI on the PR.

## Similar cases
Search: `grep -rn "atob(" apps skill --include=*.ts`, `grep -rln "atob(" apps skill --include=*.md`, and the callers of `fromBase64url` and `verifyToken`.
- **`apps/template` callers.** `fromBase64url` has one caller, `verifyToken` (`signing.ts:42`). No route in `apps/template/src` calls `signToken` or `verifyToken` (grep finds only `signing.ts` itself and `tests/signing.test.ts`). The template ships the helper for apps to use.
- **`apps/demo/src/server/signing.ts:24` — the same defect, in live use.** `diff apps/template/src/server/signing.ts apps/demo/src/server/signing.ts` is empty, and so is the diff of the two `tests/signing.test.ts`. The demo's share links use it: `apps/demo/src/server/routes/share.ts:7,18,25` (DEMO-REQ-007). So each demo share link has 4 accepted forms.
  - **It is a one-time copy, not a generated one.** `apps/demo/BUILD-RECORD.md:7` says the demo was "rebuilt from scratch by copying `apps/template`", and line 31 maps DEMO-REQ-007 to "template `signing.ts`". No step regenerates it: `scripts/` (`release-check.mjs`, `ci/path-map.json`) only names `apps/demo/**` as the DEMO component; `skill/scripts/scaffold` copies `apps/template` into a *new* app directory given on its command line; `packages/create-prototype-app/lib/create.mjs` (`npm create`) likewise copies the template into a new target folder (lines 1, 100–118) and does not mention the demo; `apps/demo/package.json` has no copy script. The git history is one squashed commit for each file (`228f122`), so it shows nothing more.
  - **So fixing the template does not fix the demo.** The demo needs the same one-line change and the same regression test in its own `tests/signing.test.ts`. If `apps/demo/` is outside item G's owned paths, it becomes a new item (plan §7a.1.8 step 4, §1 ownership). Changing only the template keeps SKILL-AC-004 green: the rule forbids an example block that equals a demo file *unless* it also equals its template source, and after the fix the blocks equal the template and no longer the demo.
- **`skill/examples/secrets.md:122`** — the byte-for-byte copy of the template's `signing.ts`. It is fixed with the template (Proposed fix).
- **Not the same case: `apps/reference/src/server/encoding.ts:10`** (`fromBase64`, copied at `skill/examples/secrets.md:63`). It decodes upload *content* sent by the reference app's own client; no signature or identity depends on its spelling. This agrees with the framework record's Similar cases.
- No other `atob(` under `apps/` or `skill/` (`.ts` files).

## Review
Status: awaiting review
