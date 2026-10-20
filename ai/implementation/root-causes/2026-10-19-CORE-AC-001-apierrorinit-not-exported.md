# Root cause: CORE-AC-001 "every framework type in a public signature is importable" — `ApiErrorInit` reachable from `./client` but not exported

Author: diagnosing subagent (prompt §8 step 1); did not write the code or the test. Date: 2026-10-19. Local only, no Cloudflare calls. No code or test changed. Needs independent review (§8 step 2) before any fix.

Branch diagnosed: `origin/claude/implement-local-cloudflare` at `9c09143` (Phase B run evidence: `b229c57`, `validation/local/phase-B/05a-integration-vitest-json.log`, failure 11 in `SUMMARY.md`).

## Symptom
`packages/framework/test/integration/core/types.test.ts` › "[CORE-AC-001] every framework type in a public signature is importable from a subpath its importers may use" fails:
```
AssertionError: expected [ Array(1) ] to deeply equal []
+ [
+   "@lago-morph/prototype-framework/client: ApiErrorInit (used by ApiError)",
+ ]
 ❯ packages/framework/test/integration/core/types.test.ts:231:42
```
The other three CORE-AC-001 tests in the file pass.

## Reproduction
`npm ci && npm run build -w packages/framework`, then
`npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/core/types.test.ts -t "every framework type"` → the same single missing entry (reproduced at `9c09143`).

## Evidence
1. `packages/framework/src/http/client.ts:8` declares `export interface ApiErrorInit extends ErrorOptions { code?, status?, requestId? }` and line 22 `constructor(message?: string, init: ApiErrorInit = {})` on the exported class `ApiError`.
2. The built declaration `packages/framework/dist/http/client.d.ts:19` (what apps see through the exports map `./client` → `dist/client/index.d.ts`) contains `constructor(message?: string, init?: ApiErrorInit);`. So `ApiErrorInit` appears in a public signature of `ApiError`.
3. `packages/framework/src/client/index.ts` (and `dist/client/index.d.ts`) re-exports `ApiError`, `api`, `ApiRequestOptions`, `ErrorCode`, `CurrentUser`, `UploadTicket`, `DownloadTicket`, the AUTH/FILES helpers and `TransferProgress` — **not** `ApiErrorInit`. `grep -rn ApiErrorInit packages/framework/src` finds only `src/http/client.ts`.
4. Experiment A (built `.d.ts` only, git-ignored `dist/`, restored afterwards): replacing `init?: ApiErrorInit` with the inline type `init?: ErrorOptions & { readonly code?: ErrorCode; readonly status?: number | null; readonly requestId?: string | null }` → `Tests 4 passed (4)`.
5. Experiment B (same method): leaving the constructor as is and appending `export type { ApiErrorInit } from "../http/client.js";` to `dist/client/index.d.ts` → `Tests 4 passed (4)`.
6. Control: originals restored → the failure returns with the identical message.

## Cause → symptom chain
- B-03 gave `ApiError` an explicit constructor whose options parameter is the named interface `ApiErrorInit` (evidence 1; DEC-0127 sets the constructor shape `(message?, { code?, status?, requestId?, cause? })`).
- `tsc` emits that signature into the public declaration of `ApiError` (evidence 2), so `ApiErrorInit` is a framework type in a public signature of `./client`.
- `./client` does not export it (evidence 3), so a browser module (which may import only `./client`, CORE-REQ-005) cannot name it.
- The test walks every type reference in the declarations of `./client`'s exports and reports framework types that are not exported from a subpath the importer may use; it reports exactly `ApiErrorInit (used by ApiError)` (symptom). Experiments A and B show that removing either the reference or the gap makes the test pass, and the control shows nothing else is involved (evidence 4–6).

## Which is wrong: code, test or contract
- **AC text** (`docs/components/core.md`, CORE-AC-001): "Every framework type appearing in a public signature can be imported from the subpath whose signatures use it." `ApiError`'s constructor is a public signature of `./client` and uses `ApiErrorInit`, which cannot be imported. The test checks exactly what the AC says; **the test is right**.
- **Contract** (`docs/contracts/ts/client.d.ts`): declares `ApiError` with no constructor, i.e. it inherits `Error`'s `(message?, options?: ErrorOptions)`, and has no `ApiErrorInit`. DEC-0127 says the implementation's init "extends `ErrorOptions`, so the contract's inherited `Error` constructor signature still type-checks (no contract change)". The contract is consistent and needs no change; **the code is wrong** in naming a type that the contract and the `./client` hub ("exactly the names of docs/contracts/ts/client.d.ts", `src/client/index.ts` header) do not expose.

## Alternatives ruled out
- *The test walks into non-public declarations.* No: the reference is in the emitted public `.d.ts` of an exported class (evidence 2).
- *Some other missing type masked by this one.* No: Experiment A (removing only this reference) leaves `missing` empty.
- *Fix by exporting `ApiErrorInit` from `./client` (Experiment B).* Makes the test pass but adds a name to `./client` that `client.d.ts` lacks, contradicting the hub's "exactly the names of client.d.ts" and requiring a **contract change** (adding `ApiErrorInit` to `docs/contracts/ts/client.d.ts`). Not proposed, since an equivalent fix without a contract change exists.

## Proposed fix (not applied)
In `packages/framework/src/http/client.ts`, remove the exported named interface from the public signature: declare the constructor's second parameter with an inline type, e.g.
`constructor(message?: string, init: ErrorOptions & { readonly code?: ErrorCode; readonly status?: number | null; readonly requestId?: string | null } = {})`
(a module-private, non-exported alias is not enough: `tsc` would still have to name or inline it; inline it directly). `ErrorCode` is already exported from `./client`; `ErrorOptions` is a lib type. Callers (`src/http/client.ts`, `src/files/client.ts:17`, AUTH client) pass object literals and are unaffected.
- Files touched: `packages/framework/src/http/client.ts` only.
- **Contract files: none touched.** No test changed.

## Verification
- Red: the existing test already fails at `9c09143` (reproduction above); per §8 step 3 the fixer records that run as the red.
- Green: after the fix and `npm run build -w packages/framework`, `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/core/types.test.ts` → 4/4 pass; check `dist/http/client.d.ts` contains no `ApiErrorInit`.
- Regression: `npm run typecheck`, `npm run test:unit`, and the browser tests using `ApiError` (`test/integration/http/api-helper.spec.ts`, `test/integration/files/transfers.spec.ts`, `test/integration/files/app-facing-types.test.ts`, `test/integration/auth/current-user.test.ts`) still pass.

## Review

Reviewer: independent root-cause reviewer (prompt §8 step 2); did not diagnose this failure or write the code or the test. Date: 2026-10-19. Local only, no Cloudflare calls. No code or test changed (the `dist/` edit below is git-ignored and was restored).

**Verdict: ACCEPTED.**

Reasons, each re-checked on `origin/claude/implement-local-cloudflare`:
- *Symptom reproduced.* After `npm ci` and `npm run build -w packages/framework`, `types.test.ts` → `1 failed | 3 passed (4)` with exactly `"@lago-morph/prototype-framework/client: ApiErrorInit (used by ApiError)"`.
- *Link 1 (code names the type).* `src/http/client.ts:8` exports `interface ApiErrorInit extends ErrorOptions`; line 22 uses it in `ApiError`'s constructor. `grep -rn ApiErrorInit packages docs` (excluding `dist/`) finds only those two lines, so nothing else depends on the name.
- *Link 2 (it reaches the public declaration).* Built `dist/http/client.d.ts:19` is `constructor(message?: string, init?: ApiErrorInit);`.
- *Link 3 (`./client` does not export it).* `src/client/index.ts:9` re-exports only `ApiError, api` from `../http/client.js`.
- *Fix experiment re-run independently (Experiment A).* Replacing the `dist` constructor parameter with the proposed inline type `ErrorOptions & { readonly code?: ErrorCode; readonly status?: number | null; readonly requestId?: string | null }` → `Tests 4 passed (4)`; original restored, `git status` clean. This also rules out a second masked missing type.
- *Contract match.* `docs/contracts/ts/client.d.ts:14–23` declares `ApiError extends Error` with no constructor and no `ApiErrorInit`, so the contract constructor is `Error`'s `(message?, options?: ErrorOptions)`. The inline type is structurally identical to the current interface (same three readonly optional fields, extends/intersects `ErrorOptions`), so it changes no caller and no type relation; it still satisfies DEC-0127 (`init` extends `ErrorOptions`, "no contract change"). `ErrorCode` is already exported by the contract and by `./client`; `ErrorOptions` is a lib type. No contract file changes.
- *Alternative correctly rejected.* Exporting `ApiErrorInit` from `./client` (Experiment B) would add a name not in `client.d.ts`, contradicting the hub's "exactly the names of client.d.ts" and needing a contract change.
- *Test strength.* The test checks the AC text literally ("Every framework type appearing in a public signature can be imported from the subpath whose signatures use it"); the fix changes code only, so the test stays as strong as the criterion.
- Minor, non-blocking: the record's remark that a non-exported alias "is not enough" is right in effect (tsc emits a non-exported local declaration into the `.d.ts`, which the walker would still report), but was not demonstrated; the fix does not rely on it.

## Fix

Fixer: fixing subagent (prompt §8 step 3); did not diagnose or review. Date: 2026-10-20. Local only, no Cloudflare calls. Branch `claude/implement-local-cloudflare-fix-core001` from `origin/claude/implement-local-cloudflare`.

- **Commit:** `26b4305` — `packages/framework/src/http/client.ts` only: removed the exported `ApiErrorInit` interface; `ApiError`'s constructor now takes `init: ErrorOptions & { readonly code?: ErrorCode; readonly status?: number | null; readonly requestId?: string | null } = {}` (structurally identical; behaviour unchanged). No contract, test or other file changed.
- **Red** (before the fix, after `npm ci && npm run build -w packages/framework`): `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/core/types.test.ts` → `Tests 1 failed | 3 passed (4)`, failing "[CORE-AC-001] every framework type in a public signature is importable…" with `+ "@lago-morph/prototype-framework/client: ApiErrorInit (used by ApiError)"` — the recorded reason.
- **Green** (after the fix and rebuild): same command → `Tests 4 passed (4)`; `grep -c ApiErrorInit packages/framework/dist/http/client.d.ts` → `0`; `grep -rn ApiErrorInit packages/framework/src` → no matches.
- **Regression:** `npm run test:unit` → `Test Files 111 passed (111)`, `Tests 1201 passed (1201)`; `npm run verify` → `verify passed` (type checking, portability, migration checker, zod version, sqlite and postgres tests all passed).
