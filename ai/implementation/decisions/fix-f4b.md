# fix-f4b — decisions integrated

Integrated into `docs/decisions/decision-log.md` (section "Implementation phase: local and Cloudflare — follow-ups after phase E, phase F demo checks") by the final integrator (plan §10.4). Parameter changes: none.

- draft entry 1 → DEC-0410 — The spec finds the demo through `COMPLIANCE_DEMO_BASE_URL`, or starts it locally
- draft entry 2 → DEC-0411 — Selectors come from the demo specification, not the round-3 demo
- draft entry 3 → DEC-0412 — What each test asserts

## Red-green non-vacuity (local, round-3 demo at `8c2af58`; evidence kept from the draft)

Each break was a temporary edit to `apps/demo/src/client/pages/*.ts`. It was reverted and never committed. The spec copies `apps/demo`, so each run tested the broken demo. The runs used `COMPLIANCE_TARGET=local npx playwright test tests/compliance/e2e/demo-pages.spec.ts --project e2e`.

| Break | Test | Result |
| --- | --- | --- |
| none (unchanged demo) | all three | 3 passed |
| post title set with `h2.innerHTML = post.title` | DEMO-AC-001 | failed: "an element shows the literal title", element not found |
| `navigator.clipboard.writeText(user.id)` replaced by `Promise.resolve()` | DEMO-AC-009 | failed: expected the user ID, received the sentinel `not-the-id-…` |
| image `src` set to `` `${downloadUrl(photo.ticket)}-broken` `` | DEMO-AC-003 | failed: expected the images to contain "3600x2400", received `["0x0"]` (10 min poll) |

After the reverts, the spec passed again through the driver on the committed tree (`e1f0009`). `npm run compliance -- --target local --only DEMO-AC-001,DEMO-AC-003,DEMO-AC-009` reported "3 passed" for the three tests and recorded 3 `passed` and 106 `not-run` (not selected). With `COMPLIANCE_TARGET=cloudflare` and no `COMPLIANCE_DEMO_BASE_URL`, a test fails with `PREREQUISITE MISSING: no running demo on cloudflare …`, which the driver records as `blocked`. That run's evidence went to a scratch directory outside the repository; the F-03 runner commits the evidence that counts.
