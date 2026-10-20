# Framework issues

Suspected framework defects found while building this app. Each entry is reproducible; none was worked around. While an entry is open, the requirements it blocks are unfinished and the app is not done.

## 1. No documented way to test browser behaviour (copy button, text-only rendering in the page)

- **Status:** open
- **Task attempted:** DEMO-AC-009 ("the copy button copies it") and the page half of DEMO-AC-001 ("a title containing `<script>` renders as text"), which the spec says the smoke test covers on a deployed stage.
- **Contract or reference consulted:** `skill/reference/testing.md`, "In-process tests" and "The smoke test"; `skill/examples/tests.md`; `skill/SKILL.md` task map ("Test (in-process, time-dependent, smoke)").
- **Minimal reproduction:** the only test tools the skill names are `createTestApp`/`connectTestStage` with `t.request` (HTTP only) and `vi` fake timers. A test that clicks the account page's "Copy ID" button (`apps/demo/src/client/pages/account.ts`, `navigator.clipboard.writeText(user.id)`) or inspects the rendered DOM needs a browser driver; the skill names none, and `tests/**` may import only the framework, `/testing`, `vitest` and app code (`skill/reference/http-and-validation.md`, "Where code goes"). Command: `npx prototype-framework verify` runs only Vitest in Node.
- **Observed code or diagnostic:** no diagnostic; the capability is absent from the references. The demo's smoke test checks only the HTTP side: `/api/auth/me` returns the mock user's ID (`tests/smoke/smoke.test.ts`, "the account's ID is the one /api/auth/me reports (DEMO-AC-009)"), and a `<script>` title round-trips unchanged as JSON (DEMO-AC-001). The client code uses only `textContent` (enforced by `no-raw-html`).
- **Expected:** a documented, allowed way to drive the app's page in a browser (locally and against a test stage), or a statement that these clauses are verified manually.
- **Workaround not taken:** importing Playwright (the repository root has a Playwright config) or jsdom into `tests/**`, or adding a browser test runner to the app's `package.json`.
- **Blocked requirements:** automated verification of DEMO-AC-009 (copy button) and of DEMO-AC-001's in-page rendering clause. The features themselves are implemented.
