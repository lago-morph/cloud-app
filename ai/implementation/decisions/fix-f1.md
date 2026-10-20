# fix-f1 decision drafts — F-02 round 1, entries 1, 3, 4, 5

Fix of root cause `ai/implementation/root-causes/2026-10-20-F-02-round-1-demo-issues.md` (entries 1, 3, 4, 5, accepted by its Review). Documentation only; local only; no Cloudflare calls.

### DEC-PENDING-fix-f1-1 — `TestApp.dispose` states that in-process views share disposal
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: `docs/contracts/ts/testing.d.ts` (`TestApp.dispose` doc comment), DEC-0193, `skill/reference/testing.md`

No type or behaviour change. The doc comment on `dispose` now states the behaviour DEC-0193 and `test-app.ts` already have: in-process, the original test app and every test app made from it with `as` share one app, so disposing any of them disposes all and later requests through any of them reject; on a connected stage it only logs that test app out and stage data is kept. Changing in-process behaviour (making a view's `dispose` a no-op) is not proposed; it would need its own decision.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: fix-f1 (root cause 2026-10-20-F-02-round-1-demo-issues, entry 4).
