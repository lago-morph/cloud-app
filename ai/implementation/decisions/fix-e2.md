# fix-e2 decision drafts — criteria are read only from criteria tables

Fix of root cause `ai/implementation/root-causes/2026-10-20-COMPL-AC-001-where-parser-decision-log.md` (accepted by its Review, fix requirements 1–6). Local only; no Cloudflare calls.

### DEC-PENDING-fix-e2-1 — A criterion is defined only by a row of a `| ID | Criterion | Verifies | Where |` table
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: COMPL-REQ-001, COMPL-REQ-002, COMPL-AC-001, compliance.md "Driver", DEC-0319

Before this decision the driver's catalogue (`tests/compliance/harness/catalogue.ts`) took any `| <AREA>-AC-NNN | … |` row of three or more cells anywhere under `docs/` as a definition, with its last cell as the Where text, and the COMPL test's independent reader (`tests/compliance/criteria/compl/support.ts` `whereSets`) took such a row of any width. DEC-0319's two-column table of criterion IDs in the decision log broke the test's reader; a three-column one would have broken the driver ("defined twice"). `docs/CONVENTIONS.md` does not define the criteria table format; every defining document uses the same header, which COMPL-AC-001 ("the criteria's "Where" columns") relies on.

Rule (both readers, implemented separately; the test shares no code with the harness):
- A row defines a criterion only when it is a body row of a table whose header row has the cells `ID`, `Criterion`, `Verifies`, `Where`, in that order (compared after trimming), with a `| --- |` separator row next. The table ends at the first line that does not start with `|`.
- The ID and the Where text are read from the `ID` and `Where` columns by index. An escaped `\|` inside a cell does not split it.
- Inside a criteria table, a body row whose cell count differs from the header's, or whose ID cell is not `<AREA>-AC-NNN`, throws with the file and line. A header row whose first two cells are `ID | Criterion` but which is not exactly that header with a separator next also throws. Rows outside criteria tables are ignored, whatever their width.
- Scenarios are unchanged: a `#### E2E-nnn` heading followed by a `Where:` line.

On the real `docs/` both readers give the same 140 IDs (124 criteria, 16 scenarios) and the same per-target, per-tier sets as before the change. No doc change: DEC-0319's table stays as written. Stating the rule in compliance.md "Driver" is left to the owner.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: fix-e2 (root cause 2026-10-20-COMPL-AC-001-where-parser-decision-log).
