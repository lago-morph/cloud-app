# fix-f4b decision drafts — F-02 round 3, fix item 3 (demo in-page clauses)

Test-case author for item 3 of the accepted fix in `ai/implementation/root-causes/2026-10-20-F-02-round-3-demo-issues.md` (Review, "Exact fix requirements"). Did not write the demo or the framework. Wrote `tests/compliance/e2e/demo-pages.spec.ts` from DEMO-AC-001, -003 and -009 and `docs/demo/demo-spec.md`. Local only; no Cloudflare calls.

### DEC-PENDING-fix-f4b-1 — The spec finds the demo through `COMPLIANCE_DEMO_BASE_URL`, or starts it locally
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: COMPL (compliance driver usage), DEMO, plan F-03

The driver starts or deploys the reference app only, and `COMPLIANCE_BASE_URL` names that app. The spec therefore does not use the harness `baseURL`. It works out the demo's origin like this:
- If `COMPLIANCE_DEMO_BASE_URL` is set, the spec uses that origin, on any target.
- If it is unset and the target is `local`, a `beforeAll` copies `apps/demo` to the git-ignored `.framework/e2e/demo-pages-<random>/`, the same way `support/apps.ts` copies apps for other E2E specs. It starts `dev` there with `support/process.ts` `startDev` and stops it in `afterAll`. Each run starts from fresh local state, and the tree stays clean (the driver's evidence check).
- If it is unset on a cloud target, every test calls `prerequisiteMissing`, so the criteria are recorded `blocked` with a reason, never passed or `not-run`.

**No driver or harness wiring was needed.** The driver passes its whole environment to Playwright (`childEnv`), so the variable reaches the spec unchanged. F-03 runs the spec against the demo's `test-` stage before it removes that stage:
`COMPLIANCE_DEMO_BASE_URL=<demo stage origin> npm run compliance -- --target cloudflare --base-url <demo stage origin> --only DEMO-AC-001,DEMO-AC-003,DEMO-AC-009`
With `--base-url`, the driver deploys no reference stage. The cloud cost is two posts, four photo, publish and delete calls, and one about 24 MB R2 object, which is deleted. That is tens of D1 rows. The F-03 estimate rules still apply.
Item: fix-f4b.

### DEC-PENDING-fix-f4b-2 — Selectors come from the demo specification, not the round-3 demo
Origin: ai-proposed · Status: accepted (assumption; owner review open) · Affects: DEMO, COMPL

The demo is rebuilt from its specification every round (round 4 is in progress), so the spec uses no demo API route, element ID or class name. It drives the page only through:
- the framework's routes `/api/auth/mock-login` (identities, on local and `test-` stages) and `/api/auth/me`;
- controls found by role and accessible name, with tolerant patterns.

**Assumed accessible names** (the `ASSUMED_*` constants in the spec). The demo specification requires these controls but does not name them:

| Control | Role | Name pattern |
| --- | --- | --- |
| title field | textbox | `/title/i` |
| text field (optional) | textbox | `/text\|body\|content\|message/i` |
| create button | button | `/create\|new (draft\|post)\|add (draft\|post)\|submit\|save draft/i` |
| attach button (optional; clicked if present) | button | `/attach\|upload\|add photo/i` |
| publish button | button | `/^publish\b/i` |
| delete button (cleanup only) | button | `/delete/i` |
| account link | link | `/account/i` |
| copy button | button | `/copy/i` |

**Assumed page flow:**
- The draft form is on the front page `/`.
- After creating a draft, the app either goes to the post or lists it as a link named by its title. The spec opens it through that link.
- The file picker for photos is on the post page.
- Published posts are listed on `/` as links named by their titles.

**One structural selector:** `input[type="file"]`, because a file picker has no required accessible name.

**How each clause is checked:**
- The title check looks for elements whose whole text is the title (`getByText(…, { exact: true })`), in any role.
- The photo check scans `document.images` for an image whose natural size is the photo's 3600×2400, then repeats the check on a fresh load of the post.

The round-3 demo matches all of these. The whole spec must be re-checked against the round-4 demo before the F-03 run.
Item: fix-f4b.

### DEC-PENDING-fix-f4b-3 — What each test asserts
Origin: ai-proposed · Status: accepted (assumption; owner review open) · Affects: DEMO-AC-001, DEMO-AC-003, DEMO-AC-009

**DEMO-AC-001.**
- An admin creates a draft through the page. The title is `Hello <script>window.demoPagesXss<id>=1</script> <id>`. The specification lets admins create drafts and publish any post, so no user's draft has to be reached by an admin.
- On the author's post page, then in an anonymous visitor's list on `/`, then on the visitor's view of the post, the spec checks:
  - an element shows exactly the literal title as its rendered text;
  - that element has no child elements;
  - no `script` element contains the marker;
  - `window[marker]` is undefined.
- The post is deleted through the page afterwards.

**DEMO-AC-003.**
- The browser encodes a random-pixel 3600×2400 baseline JPEG at quality 1. It is about 24.5 MB, and the test requires at least 20 MiB, so it counts as 20 MB under either reading. It also checks the `FFD8FF` signature.
- The JPEG is attached through the post page's file picker.
- Pass: an image on the post is `complete` with natural size 3600×2400, so `naturalWidth` > 0. This holds both after the upload and on a fresh load of the post.
- The download and byte-identity clause is left to the smoke test and is not claimed here.

**DEMO-AC-009.**
- Clipboard read and write are granted for the demo origin, and a sentinel is written to the clipboard first.
- The user reaches the account page through the page's own link and clicks the copy button.
- Pass: the clipboard then holds exactly the `id` that `/api/auth/me` returns, which is the ID given to the mock login.

The tests are independent: no serial mode, so one test failing does not skip the others. The file is named without a scenario ID and is tagged only DEMO-AC-001, DEMO-AC-003 and DEMO-AC-009, not E2E-015.
Item: fix-f4b.

## Red-green non-vacuity (local, round-3 demo at `8c2af58`)

Each break was a temporary edit to `apps/demo/src/client/pages/*.ts`. It was reverted and never committed. The spec copies `apps/demo`, so each run tested the broken demo. The runs used `COMPLIANCE_TARGET=local npx playwright test tests/compliance/e2e/demo-pages.spec.ts --project e2e`.

| Break | Test | Result |
| --- | --- | --- |
| none (unchanged demo) | all three | 3 passed |
| post title set with `h2.innerHTML = post.title` | DEMO-AC-001 | failed: "an element shows the literal title", element not found |
| `navigator.clipboard.writeText(user.id)` replaced by `Promise.resolve()` | DEMO-AC-009 | failed: expected the user ID, received the sentinel `not-the-id-…` |
| image `src` set to `` `${downloadUrl(photo.ticket)}-broken` `` | DEMO-AC-003 | failed: expected the images to contain "3600x2400", received `["0x0"]` (10 min poll) |

After the reverts, the spec passed again through the driver on the committed tree (`e1f0009`). `npm run compliance -- --target local --only DEMO-AC-001,DEMO-AC-003,DEMO-AC-009` reported "3 passed" for the three tests and recorded 3 `passed` and 106 `not-run` (not selected). With `COMPLIANCE_TARGET=cloudflare` and no `COMPLIANCE_DEMO_BASE_URL`, a test fails with `PREREQUISITE MISSING: no running demo on cloudflare …`, which the driver records as `blocked`. That run's evidence went to a scratch directory outside the repository; the F-03 runner commits the evidence that counts.
