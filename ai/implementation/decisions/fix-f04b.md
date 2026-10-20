# fix-f04b — decision drafts

### DEC-PENDING-fix-f04b-1 — Every download is `attachment; filename*=…` on every target, raster images included
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: DEC-0313, DEC-0329, FILES-REQ-003, COMPL-REQ-001, E2E-009, files.md §2 ("Download names", Local), `skill/reference/files.md` "Downloads", `packages/framework/src/files/{cloudflare/disposition.ts, cloudflare/tickets.ts, local/route.ts}`, D-02

Supersedes the raster-`inline` part of DEC-0313 and the content-type part of DEC-0329. A storage response to a download ticket carries `Content-Disposition: attachment; filename*=UTF-8''<RFC 8187 value-chars of the whole name>` for every content type, raster images included, on local and on Cloudflare. `downloadDisposition(name)` takes no content type; `RASTER_IMAGES` and `isRasterImage` are removed; the Cloudflare issuer's `download` takes only the name. The local route keeps `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`. `service.ts`, `TicketIssuer` and `targets/cloudflare/tickets.ts` are unchanged: they already pass no content type, which is now the whole contract (the third gap of the R-06 record, E3, closes because nothing needs a content type any more). DEC-0329's other content stays: the one shared helper, the RFC 8187 encoding, R2's signed `response-content-disposition`, and D-RUN's check that R2 honours it on a presigned GET.

Reasons: (1) no FILES REQ, contract or AC asks for inline images; "displays" in DEMO-REQ-003, DEMO-AC-003 and E2E-009 is met through `<img src>`, which ignores `Content-Disposition`. (2) The old behaviour differed by target (local `inline`, Cloudflare `attachment`), which COMPL-REQ-001 forbids without a criterion that states it. (3) R-06 experiment E9: across origins Chromium ignores `<a download>`, so an `inline` image on an R2 ticket URL would navigate instead of downloading and break E2E-009 on Cloudflare. Evidence: `ai/implementation/root-causes/2026-10-20-e2e-016-r06-raster-inline-disposition.md` and its Review; the parity test "a raster image downloads with the same Content-Disposition on local and Cloudflare" in `packages/framework/src/files/local/route.unit.test.ts` failed before the fix (local `inline; filename*=UTF-8''p.png`, Cloudflare `attachment; filename*=UTF-8''p.png`) and passes after it.

Visible change: locally, a raster download opened in a new tab (the demo's `target=_blank` photo link, the template's `window.open`) now downloads instead of displaying, as it already did on Cloudflare. Images shown with `<img src>` still display; no requirement or test depends on the old behaviour (plan §11 Q5).

For the integrator: DEC-0313's status still reads "not yet implemented", which is stale (implemented by D-02, `disposition.ts`); mark it. Invalidations: none needed (`validation/invalidations.md` is empty and no milestone record exercising FILES downloads exists); if one is recorded before this merges, add a line for it (COMPL-REQ-006, adapter code).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: fix-f04b.

## Parameter changes

None.
