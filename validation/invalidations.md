# Milestone invalidations

Each list line below invalidates the latest record of the milestone items it names (COMPL-REQ-006, compliance.md "Tiers"). The release report (`node tests/compliance/tools/report.mjs release`) reads only the list lines, in this form:

```
- <YYYY-MM-DD or ISO time> | <ID>, <ID> | <reason>
```

A date alone means the end of that day (UTC): every record finished on or before it is invalidated, so a re-run on the same day must be recorded after an entry with a full time, or on a later day. Add an entry after major restructuring of the framework, after a change to PROV, MIG, CF, AWS or adapter code, or whenever a milestone item must be run again. Elapsed time never invalidates a record. Never edit or remove an entry; add a new one.

## Entries

