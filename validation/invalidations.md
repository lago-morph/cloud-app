# Milestone invalidations

Each list line below invalidates the latest record of the milestone items it names (COMPL-REQ-006, compliance.md "Tiers"). The release report (`node tests/compliance/tools/report.mjs release`) reads only the list lines, in this form:

```
- <YYYY-MM-DD or ISO time> | <ID>, <ID> | <reason>
```

A date alone means the end of that day (UTC): every record finished on or before it is invalidated, so a re-run on the same day must be recorded after an entry with a full time, or on a later day. Add an entry after major restructuring of the framework, after a change to PROV, MIG, CF, AWS or adapter code, or whenever a milestone item must be run again. Elapsed time never invalidates a record. Never edit or remove an entry; add a new one.

## Entries

- 2026-10-25T15:30:43Z | PROV-AC-003, PROV-AC-004, PROV-AC-006, MAIL-AC-007, E2E-010, E2E-012, COMPL-AC-008 | batch B changes PROV, MIG and CF code: the backup bucket among the shared resources and the production remove backup (DEC-0543), stop/start and the stage record (DEC-0544), the native D1 copy (DEC-0545), the plan-dependent D1 limit (DEC-0546)
