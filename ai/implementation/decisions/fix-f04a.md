# fix-f04a — decision drafts

### DEC-PENDING-fix-f04a-1 — Docs-only portability notes invalidate no milestone record
Origin: ai-proposed · Status: accepted · Affects: COMPL-REQ-006, E2E-016, docs/components/{aws,check,cli,cloudflare,compliance,local,skill}.md

COMPL-REQ-006 requires a milestone item to be run again "after a change to PROV, MIG, CF, AWS, or adapter code". "Code" qualifies the whole list, so adding the `## 5. Portability note` sections (E2E-016 R-01) to these documents, `cloudflare.md` and `aws.md` included, is not such a change: it invalidates no milestone record and needs no `validation/invalidations.md` entry. The R-01 root-cause Review confirmed this reading (`ai/implementation/root-causes/2026-10-20-e2e-016-r01-portability-notes.md`, Review, "COMPL-REQ-006 reading"). E2E-016 (review part) is recorded again by the F-04 re-review in any case.

## Parameter changes

None.
