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
