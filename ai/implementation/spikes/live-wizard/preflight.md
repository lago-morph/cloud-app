# Live wizard pass: read-only preflight

Date: 2026-10-26. Read-only: GET requests only, through the guarded layer
(`guarded-api.ts`); nothing was created, changed or deleted. Calls used: 7 (limit 49).
Values that identify the account (token values and IDs, account ID, zone IDs, the `workers.dev`
subdomain) are redacted and were never printed.

## Environment token (`CLOUDFLARE_API_TOKEN`)
- Valid: yes (status active)
- Has an expiry: no
- Its ID was read and is protected by the guard (not recorded here).

## Tokens
- `prototype-compliance-wizard-*` tokens listed: 0 (expected 0)
- Other `prototype-compliance-*` or compliance hook tokens listed: 0

## Worker scripts (baseline)
- `demo-test-z8ey6q3j123mpoe`
- `prototype-mailsink`
- `reference-prodcheck`

Stages (app / stage, from the stage Workers `<app>-<stage>`; account Workers `prototype-mailsink` excluded):
- `demo / test-z8ey6q3j123mpoe`
- `reference / prodcheck`

## R2 buckets (baseline)
- `demo-test-z8ey6q3j123mpoe-files`
- `prototype-backups`
- `prototype-logs`
- `prototype-mailsink`
- `reference-prodcheck-files`
- `sst-state`

## D1 databases (baseline)
- `demo-test-z8ey6q3j123mpoe-db-1`
- `reference-prodcheck-db-1`

## Setup record (`framework/account.json` in `sst-state`)
- Exists: yes
- `setupVersion`: absent (a record from before the setup fields)

## Owner's end condition
Only the existing `prodcheck` and demo stages must remain at the end of the pass; compare the lists above with the pass's end state.
