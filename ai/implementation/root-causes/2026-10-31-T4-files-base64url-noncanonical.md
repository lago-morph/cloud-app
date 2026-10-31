# Root cause: `files/base64url.ts` accepts non-canonical base64url, so each local transfer ticket's MAC has 4 accepted spellings and each FILES list cursor several

Author: item T4 (diagnosis, plan §7a.1.8 step 1), 2026-10-31. Found by fuzz target F4 (S4, `ai/implementation/v0.2.0-coverage-fuzz.md` §2), which S4 predicted would fail. Branch `v0.2.0/88-fuzz-targets` at `07922db` (based on `v0.2.0/55-merge-auth-app-into-bootstrap`, PR #94). Item T4 is the implementer and also the diagnoser; no separate diagnoser subagent was available (see "Process").

## Symptom
On `88-fuzz-targets`, `npx vitest run --config vitest.unit.config.ts packages/framework/src/files/local/tickets.fuzz.unit.test.ts packages/framework/src/files/cursor.fuzz.unit.test.ts` (Node v22.23.4) gives 3 failures:

```
× F4 … no mutation of a valid ticket verifies (500 runs, seed 2026103104)
  Property failed after 7 tests  { seed: 2026103104, … }
  Counterexample: [{"op":"upload","name":"\u0000","contentType":"image/png"},{"kind":"respell-end","part":1,"flip":1}]
  (verifyLocalTicket returned the grant for the mutated token instead of undefined)
× F4 … base64urlToBytes and base64urlToText return a value only for its canonical spelling (500 runs, seed 2026103104)
  Counterexample: ["AO"]   Expected: "AO"  Received: "AA"
× F6 … decoding any string gives a name inside the prefix, or FILES.INVALID_CURSOR (1000 runs, seed 2026103106)
  Counterexample: ["eyJwIjoiYS8iLCJhIjoiYS8ifR","a/"]
  Expected: "eyJwIjoiYS8iLCJhIjoiYS8ifR"  Received: "eyJwIjoiYS8iLCJhIjoiYS8ifQ"
```

The same mutations of the auth tokens (`auth/signing.fuzz.unit.test.ts`, the same seed, 4 properties) and of KV cursors (`kv/cursor.fuzz.unit.test.ts`) pass.

## Evidence
- **Minimal reproduction** (the script in the Appendix, run with `node` against `packages/framework/dist` built from `07922db`). A download ticket for `a.png`, whose 43-character MAC ends in `…tWA`:

  ```
  MAC length 43 chars -> 32 bytes
  ticket MAC spelling tWA verifyLocalTicket: {"op":"download","name":"a.png"} signing.base64urlDecode: bytes
  ticket MAC spelling tWB verifyLocalTicket: {"op":"download","name":"a.png"} signing.base64urlDecode: undefined
  ticket MAC spelling tWC verifyLocalTicket: {"op":"download","name":"a.png"} signing.base64urlDecode: undefined
  ticket MAC spelling tWD verifyLocalTicket: {"op":"download","name":"a.png"} signing.base64urlDecode: undefined
  base64urlToBytes("AA") [ 0 ] base64urlToBytes("AB") [ 0 ] base64urlDecode("AB") undefined
  base64urlToText("AO") === "\u0000" (same as AA: "\u0000")
  files cursor ifQ -> a/      files cursor ifR -> a/      files cursor ifS -> a/      files cursor ifT -> a/
  kv cursor iJd -> a/b        kv cursor iJc -> KV.INVALID_CURSOR   (iJf, iJe: KV.INVALID_CURSOR)
  ```
- **The decoder** (`files/base64url.ts:10-14`): `base64urlToBytes` checks the alphabet and `length % 4 !== 1`, then returns `atob(...)`'s bytes. It never re-encodes. `atob` (WHATWG forgiving-base64) discards the leftover bits of the last character: 2 bits when `length % 4 === 3` (a 32-byte MAC is 43 characters), 4 bits when `length % 4 === 2`.
- **The two other copies check canonical form:** `auth/signing.ts:22-32` `base64urlDecode` returns bytes only when `base64urlEncode(bytes) === text`; `kv/cursor.ts:37` throws when `toBase64Url(bytes) !== cursor`. So the drift is between copies of one rule (S4's evidence for F4).
- **Callers of `files/base64url.ts`:** only `files/local/tickets.ts:7` (MAC via `base64urlToBytes`, payload via `base64urlToText`) and `files/cursor.ts:7` (`base64urlToText`); `grep -rn 'base64url.js"' packages/framework` finds nothing else.
- **The ticket body is not affected:** `verifyLocalTicket` signs and verifies the body *text* (`tickets.ts:30`, `:59`), so a re-spelled body changes the signed data and fails verification. Only the MAC part, which is decoded to bytes before `crypto.subtle.verify`, has extra spellings. The fuzz counterexample is on part 1 (the MAC).
- **Experiment confirming the cause:** with `base64urlToBytes` changed to return `bytesToBase64url(bytes) === text ? bytes : undefined` (uncommitted, reverted after), `vitest run` over `packages/framework/src/{auth,files,kv}` passed: 50 files, 596 tests, including the three properties above.

## Causal chain
1. `verifyLocalTicket` decodes the MAC with `base64urlToBytes` and verifies those bytes. Shown by `tickets.ts:56-58`.
2. `base64urlToBytes` maps every spelling whose last character differs only in the discarded low bits to the same bytes. Shown by `base64urlToBytes("AA")` and `("AB")` both giving `[0]`, and the 4 MAC spellings giving the same grant.
3. So the 4 spellings of a 43-character MAC all verify. Shown by the reproduction and by the F4 counterexample (`respell-end`, part 1).
4. `files/cursor.ts` decodes cursors with the same function (through `base64urlToText`), so a FILES cursor has 4 (length % 4 = 3) or 16 (length % 4 = 2) accepted spellings. Shown by the 4 `files cursor` lines and the F6 counterexample. KV's own decoder rejects them (the `kv cursor` lines).
5. The fix experiment removes every failure and breaks no other test in the three components. Shown by the 596 passing tests.

## Alternatives ruled out
- **A forgery or key problem:** every accepted spelling decodes to the *same* 32 MAC bytes, which `crypto.subtle.verify` checks against the real key. No new MAC is accepted. It is a malleability and drift defect, not a forgery (S4).
- **The fuzz test is wrong:** the property ("no mutation of a valid ticket verifies"; "a decoder returns a value only for its canonical spelling") is S4's, confirmed by the S4 reviewer. The same mutation passes on `auth/signing.ts` and on KV cursors, so the generator does not produce false positives on canonical decoders.
- **`atob` differs between Node and workerd:** both implement WHATWG forgiving-base64, which discards the leftover bits. In any case the reproduction is in Node, where the unit tests and the local target run.
- **The ticket payload or cursor JSON:** they are signed as text (tickets) or compared after parsing (cursor); the extra spellings come only from the byte decoding.

## Proposed fix
As amended by the review (Response, round 1; accepted in round 2):
- **`packages/framework/src/files/base64url.ts`.**
  - `base64urlToBytes` returns the bytes only when they re-encode to the input: `return bytesToBase64url(bytes) === text ? bytes : undefined;`. This matches `auth/signing.ts` and `kv/cursor.ts`.
  - `base64urlToText` goes through `base64urlToBytes`, and now decodes with `{ fatal: true, ignoreBOM: true }`. A leading BOM therefore stays in the text, and re-encoding gives the input back.
- **`packages/framework/src/kv/cursor.ts`.** The same `ignoreBOM: true`. A cursor with a BOM then fails `JSON.parse` and is KV.INVALID_CURSOR.
- **No caller changes.** The tokens and cursors the framework issues are canonical and never start with a BOM, so no issued value stops working.

The red tests:
- the F4 files properties and both F6 cursor properties. The fuzz generators gained BOM-prefixed inputs, and the cursor properties gained the "exactly the UTF-8 JSON" check (Response, round 1);
- the shrunk counterexamples as plain regression tests (plan §7a.1.7):
  - `files/local/tickets.unit.test.ts`: a MAC re-spelled in its last character is refused;
  - `files/cursor.unit.test.ts`: a re-spelled cursor and a BOM-prefixed cursor are FILES.INVALID_CURSOR;
  - `kv/cursor.unit.test.ts`: a BOM-prefixed cursor is KV.INVALID_CURSOR.

## Similar cases (plan §7a.1.8 step 4)
Search: `grep -rn "atob(" packages apps skill --include=*.ts`, plus the callers of each decoder found.
- **`apps/template/src/server/signing.ts` `fromBase64url`, copied verbatim into `apps/demo/src/server/signing.ts`.** The app template's share-link signatures (`verifyToken`) have the same defect: it pads and `atob`s with no canonical check. Reproduced with the template's code (Node v22.23.4): all 4 spellings of a signature verify. This is **outside T4's owned paths**, so it is not fixed here. The evidence is in its own stub, `2026-10-31-T4-template-signing-noncanonical.md`; the orchestrator schedules the fix with item G.
- **`kv/cursor.ts`:** its base64 decoding is canonical (it rejects the re-spellings above). But it has the same BOM gap as `base64urlToText` (review round 1, major 3). It is fixed here, because it is in F6's scope.
- **`auth/signing.ts` `base64urlDecode`:** canonical (F4's auth properties pass).
- **Not the same case:** `apps/reference/src/server/encoding.ts` `fromBase64` decodes upload *content* sent by the reference app's own client (`routes/files.ts:33`); no signature or identity depends on its spelling. `mail/mime.ts` `base64Bytes` decodes test mail bodies in the MAIL reader that B 45/46 retire.
- The FILES cursor case (link 4) is fixed by the same change, and its failing test is F6's FILES property.

## Verification plan
- **Red.** Branch `89` at `46e5650`, plus the re-added fuzz files and the regression tests, without the source fix. Command: `npx vitest run --config vitest.unit.config.ts` on the four fuzz files and the three unit files; Node v22.23.4. Result: 7 failed, 26 passed. The exact output, trimmed to the failure lines:

  ```
  FAIL  files/cursor.fuzz.unit.test.ts > F6: FILES list cursors fuzz (FILES-REQ-001) > decoding any string gives a name inside the prefix, or FILES.INVALID_CURSOR (1000 runs, seed 2026103106)
  Error: Property failed after 28 tests
  Counterexample: ["77u_eyJwIjoiIiwiYSI6IiJ9",""]
  Caused by: SyntaxError: Unexpected token '\ufeff', "\ufeff{"p":"","a":""}" is not valid JSON
  FAIL  files/cursor.unit.test.ts > [FILES-AC-001] list cursors … > only the issued spelling of a cursor decodes: not a re-spelled last character, not a byte order mark in front (fuzz F6)
  AssertionError: expected undefined to be 'FILES.INVALID_CURSOR'
  FAIL  kv/cursor.fuzz.unit.test.ts > F6: KV list cursors and prefix ranges fuzz (KV-REQ-003, kv.md §2) > decoding any string gives a valid key inside the prefix, or KV.INVALID_CURSOR (1000 runs, seed 2026103106)
  Error: Property failed after 212 tests
  Counterexample: ["77u_WyIiLCJhIl0",""]
  Caused by: SyntaxError: Unexpected token '\ufeff', "\ufeff["","a"]" is not valid JSON
  FAIL  kv/cursor.unit.test.ts > cursor > [KV-AC-003] a cursor with a byte order mark in front of its JSON is rejected with KV.INVALID_CURSOR (fuzz F6)
  AssertionError: expected undefined to be 'KV.INVALID_CURSOR'
  FAIL  files/local/tickets.fuzz.unit.test.ts > F4: local transfer tickets fuzz (files.md §2 Local) > no mutation of a valid ticket verifies (250 runs, seed 2026103104)
  Error: Property failed after 3 tests
  Counterexample: [{"op":"download","name":"\u0000"},{"kind":"respell-end","part":1,"flip":1}]
  Caused by: AssertionError: expected { op: 'download', name: '\u0000' } to be undefined
  FAIL  files/local/tickets.fuzz.unit.test.ts > F4: local transfer tickets fuzz (files.md §2 Local) > base64urlToBytes and base64urlToText return a value only for its canonical spelling (500 runs, seed 2026103104)
  Error: Property failed after 2 tests
  Counterexample: ["Ao"]
  Caused by: AssertionError: expected 'Ag' to be 'Ao'
  FAIL  files/local/tickets.unit.test.ts > local tickets … > a ticket whose signature is re-spelled in its last character is refused (fuzz F4)
  AssertionError: eyJvIjoiZG93bmxvYWQiLCJuIjoiYS5wbmciLCJlIjoxNzkzNDQyNTQyODExfQ.NIww85ykZoE3P8ozy_dXV6-Ou4LQv0kXkjQrNDZBiip: expected { op: 'download', name: 'a.png' } to be undefined
  ```

  (In the two SyntaxError lines, `\ufeff` stands for the BOM that Node prints as an invisible character. The ticket in the last line was signed with the test's generated dummy key.)
- **Green (on `89`, with the fix).** `vitest run` over `packages/framework/src/{auth,files,kv}`: 49 files, 598 tests passed. `npm run build -w packages/framework && npm run typecheck && npm run lint && npm run test:unit` and CI pass on the PR.
- **The structure changed after the review** (orchestrator; DEC-0776, amended): no PR may be red in CI. So the F4 and F6 fuzz files were removed from `88` and land in `89` together with the fix. The red above is the evidence of red-green: anyone can reproduce it by reverting the two source files of the fix commit.

## Process
Item T4 had no subagent tool, so it diagnosed its own finding. The review is by a fresh, independent Claude Code remote session that did not write the test or the code (plan §7a.1.8 step 2).

## Review
Reviewer: an independent Claude Code remote session (`session_014mWQ6iUAmPMoYo2DWNgSsL`), 2026-10-31, round 1, read-only, on commit `f5de06d`. It reproduced the three failures and the Appendix output. It then applied both proposed fixes as uncommitted experiments and reverted them:
- the fuzz files passed at the fixed seeds, and at seeds 1–3 with 5,000 runs (F4) and 20,000 runs (F6);
- `auth`, `files` and `kv` passed (50 files, 596 tests);
- the full unit suite had 1 unrelated failure: MIG-AC-003, the known tie in `2026-10-31-C-mig-record-order-tie.md`, which passes alone.

**Verdict: accepted-with-changes.**
1. **minor:** Every link reproduces, and the alternatives are ruled out (the same 32 bytes reach `crypto.subtle.verify`; the ticket body is signed as text).
2. **major:** The fix misses a case the cited property covers. `base64urlToText` decodes with `TextDecoder("utf-8", { fatal: true })`, and `ignoreBOM` defaults to false, so a leading UTF-8 BOM is dropped. With the proposed fix applied, `base64urlToText("77u_")` is `""`, which re-encodes to `""`. A FILES cursor with a BOM in front (`77u_eyJwIjoiYS8iLCJhIjoiYS94In0`) still decodes to `a/x`. Required: `ignoreBOM: true` (or a text re-encode check), a regression test for `77u_…`, and BOM-prefixed inputs in F4's and F6's generators. The generators never produced this input.
3. **major:** "Similar cases" wrongly calls `kv/cursor.ts` canonical. It has the same BOM gap (`kv/cursor.ts:36`): `77u_WyJhLyIsImEveCJd` decodes to `a/x`. F6's KV property passes only because it compares the base64 re-encoding of the bytes, which keep the BOM. Required: count it as a similar case, give it a failing test, and fix it the same way. It is in F6's scope.
4. **minor:** The fuzz properties are faithful to S4, neither weaker nor stronger. The canonical-bytes check on the FILES cursor comes from F4's decoder rule.
5. **minor:** The reviewer did not re-run the template case, but confirmed that `apps/template/src/server/signing.ts:24` and `apps/demo/src/server/signing.ts:24` decode the same way. Sending it out as a new item is correct. Leaving out `reference/encoding.ts` and `mail/mime.ts` is reasonable.

## Response (round 1)
- **To 2 (major).**
  - **Reproduced** on `f5de06d`'s build (script `evidence-bom.mjs`, added to the Appendix):
    - `base64urlToText("77u_")` is `""`, which re-encodes to `""`;
    - `files cursor with BOM 77u_eyJwIjoiYS8iLCJhIjoiYS94In0 -> "a/x"`.
  - **Revised fix.** `base64urlToText` decodes with `{ fatal: true, ignoreBOM: true }`. A leading BOM then stays in the text: `"77u_"` decodes to `"﻿"` and re-encodes to `"77u_"`. Together with the canonical byte check, decoding then returns a value only for its one spelling. A FILES cursor with a BOM then fails `JSON.parse` (a BOM is not JSON whitespace), so it is FILES.INVALID_CURSOR.
  - **Tests.**
    - F4's decoder property gets BOM-prefixed constants (`77u_`, `77u_YQ`).
    - Both cursor properties get BOM-prefixed issued cursors and a stronger check: the cursor's bytes are exactly the UTF-8 JSON of the requested prefix and the returned key or name. This check is kv.md §2's "exactly that form"; JSON whitespace is allowed, since neither decoder documents a canonical JSON spelling.
    - These generator changes go into the fuzz files on `88`, where they are red, and are merged forward.
    - Plain regression tests for `77u_…` go in `files/cursor.unit.test.ts` and `kv/cursor.unit.test.ts`.
- **To 3 (major).** Reproduced: `kv cursor with BOM 77u_WyJhLyIsImEveCJd -> "a/x"`. `kv/cursor.ts` is now counted as a similar case with the same cause (a `TextDecoder` that drops a BOM). It gets the same one-line fix (`ignoreBOM: true`) and is added to this record's fix files. Its failing test is F6's strengthened KV property plus the regression test.
- **Further similar cases, from a search for `new TextDecoder("utf-8", { fatal: true })`.**
  - `auth/signing.ts:78` decodes a session or login token's payload.
  - `auth-app/id-token.ts:35` decodes an ID token's payload.

  Both have the same decoder settings, but in both the MAC or signature covers the *encoded* text. So a BOM cannot be added without the key, and no extra spelling is accepted: F4's auth properties pass with the `respell-end` and insertion mutations. No change there.
- **To 4 and 5.** Agreed; no change.
- **Revised fix files:**
  - `packages/framework/src/files/base64url.ts` (the canonical byte check and `ignoreBOM: true`);
  - `packages/framework/src/kv/cursor.ts` (`ignoreBOM: true`);
  - the regression tests in `files/local/tickets.unit.test.ts`, `files/cursor.unit.test.ts` and `kv/cursor.unit.test.ts`.
- **Revised verification plan.** Red: on `88`, F4's files properties and both F6 cursor properties fail. Green: on `89`, they pass, along with the regression tests. Only F1 fails until `89b`.


## Review (round 2)
Same reviewer session, 2026-10-31, on commit `6227b36`. It applied the revised fix as an experiment and reverted it. Without the fix, the strengthened properties fail as stated: FILES `["77u_eyJwIjoiIiwiYSI6IiJ9",""]`, KV `["77u_WyIiLCJhIl0",""]`, and F4's decoder `["Ao"]`. With it:
- `base64urlToText("77u_")` is `"\uFEFF"`;
- a FILES cursor with a BOM is FILES.INVALID_CURSOR, and `base64urlToText("AB")` is `undefined`;
- `vitest run` over `src/{files,kv,auth}` passes 595 of 596. The one failure is F1, which is record 2's and is fixed on `89b`;
- the full unit suite passes 2,744 of 2,745, again failing only F1.

**Verdict (round 2): accepted.**
1. **minor:** Major 2 is resolved: `ignoreBOM: true` plus the canonical byte check.
2. **minor:** Major 3 is resolved: `kv/cursor.ts` is counted as a similar case and gets the same one-line fix. With it, `77u_WyJhLyIsImEveCJd` is KV.INVALID_CURSOR.
3. **minor:** `auth/signing.ts:78` and `auth-app/id-token.ts:35` are treated correctly. Their MAC or signature covers the encoded text, and their bodies also go through the canonical `base64urlDecode`.
4. **minor:** The strengthened properties are faithful. They require exactly `{p, a}` or `[prefix, key]`, allow JSON whitespace and refuse a BOM, which is no stronger than kv.md §2 documents. The `\uXXXX` escapes change only how characters are written.
5. **minor:** No regressions.
6. **minor:** `## Proposed fix` was stale. *Done:* it is rewritten above.
7. **minor:** The diagnoser's own status line should go. *Done:* removed.

## Appendix: reproduction script
Run as `D=$PWD/packages/framework/dist node repro.mjs` from the repo root, after `npm run build -w packages/framework`.

```js
const D = process.env.D;
const { createLocalTicketIssuer, verifyLocalTicket, LOCAL_TRANSFER_PATH } = await import(`${D}/files/local/tickets.js`);
const { base64urlToBytes, base64urlToText } = await import(`${D}/files/base64url.js`);
const { base64urlDecode } = await import(`${D}/auth/signing.js`);
const { decodeCursor: filesDecode, encodeCursor: filesEncode } = await import(`${D}/files/cursor.js`);
const { decodeCursor: kvDecode, encodeCursor: kvEncode } = await import(`${D}/kv/cursor.js`);

const B = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const spellings = (s) => [0, 1, 2, 3].map((f) => s.slice(0, -1) + B[B.indexOf(s.slice(-1)) ^ f]);
const key = `evidence-key-${"k".repeat(32)}`; // a dummy key, not a credential
const issuer = createLocalTicketIssuer({ key: async () => key });
const token = (await issuer.download("a.png")).url.slice(LOCAL_TRANSFER_PATH.length);
const [body, mac] = token.split(".");
console.log("MAC length", mac.length, "chars ->", base64urlToBytes(mac).length, "bytes");
for (const m of spellings(mac)) {
  console.log("ticket MAC spelling", m.slice(-3), "verifyLocalTicket:", JSON.stringify(await verifyLocalTicket(`${body}.${m}`, key)), "signing.base64urlDecode:", base64urlDecode(m) === undefined ? "undefined" : "bytes");
}
console.log('base64urlToBytes("AA")', [...base64urlToBytes("AA")], 'base64urlToBytes("AB")', [...base64urlToBytes("AB")], 'base64urlDecode("AB")', base64urlDecode("AB"));
console.log('base64urlToText("AO") ===', JSON.stringify(base64urlToText("AO")), "(same as AA:", JSON.stringify(base64urlToText("AA")) + ")");
for (const s of spellings(filesEncode("a/", "a/"))) {
  let r;
  try { r = filesDecode("a/", s); } catch (e) { r = e.code; }
  console.log("files cursor", s.slice(-3), "->", r);
}
for (const s of spellings(kvEncode("a/", "a/b"))) {
  let r;
  try { r = kvDecode(s, "a/"); } catch (e) { r = e.code; }
  console.log("kv cursor", s.slice(-3), "->", r);
}
```

The template case (Similar cases) was reproduced by running `fromBase64url`, `toBase64url` and `verifyToken`'s HMAC check copied from `apps/template/src/server/signing.ts` on a fresh signature and its 3 re-spellings: all 4 verified.

`evidence-bom.mjs` (Response, round 1), run the same way:

```js
// BOM spellings (review round 1 of the F4 record). Runs against the built dist.
const D = process.env.D;
const { base64urlToText, textToBase64url } = await import(`${D}/files/base64url.js`);
const { decodeCursor: filesDecode, encodeCursor: filesEncode } = await import(`${D}/files/cursor.js`);
const { decodeCursor: kvDecode, encodeCursor: kvEncode } = await import(`${D}/kv/cursor.js`);
const bom = (c) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(c, "base64url")]).toString("base64url");
console.log('base64urlToText("77u_") =', JSON.stringify(base64urlToText("77u_")), "re-encodes to", JSON.stringify(textToBase64url(base64urlToText("77u_") ?? "")));
const run = (label, f) => {
  try { console.log(label, "->", JSON.stringify(f())); } catch (e) { console.log(label, "->", e.code); }
};
const fc = bom(filesEncode("a/", "a/x"));
const kc = bom(kvEncode("a/", "a/x"));
run(`files cursor with BOM ${fc}`, () => filesDecode("a/", fc));
run(`kv cursor with BOM ${kc}`, () => kvDecode(kc, "a/"));
```
