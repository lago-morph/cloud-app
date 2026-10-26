# Pass 5 — re-run of the pass-4 failures (2026-10-26)

Code: `claude/better-auth` at feab5a2. Before the run there was no stale harness lock and the pending-stage list was empty. The logs are in `logs/` and have been redacted: a scan of 97 new files found no token, account ID, zone ID, subdomain or owner name.

| Run | Record | Result |
|---|---|---|
| Cloudflare, stage `test-qsyokeqbxq2nush`, 00:41–01:14Z | `qsyokeqbxq2nush` | **7/7 passed:** PWD-AC-009, E2E-008, MIG-AC-003, PROV-AC-002, SEC-AC-005, E2E-011, E2E-014. Exit code 0, no leftovers. |
| check-login on `prodcheck`, redeployed with the new code | `id6eeg6kjx9wfbi` | **Passed:** PWD-AC-009, AUTH-AC-011 and E2E-008. The step-8 burst got its 429. |
| DEMO-AC-008 on the demo stage `test-z8ey6q3j123mpoe` | `m1795xllwtti58a` | **Passed.** The demo was not redeployed: nothing it runs changed since pass 4. |
| Local | `zouaxszod98yyh1` | **Passed:** DEMO-AC-008, E2E-011, E2E-014 and MIG-AC-003. The other four criteria have no local part. |

**Budget**
- **Cloudflare API:** 1,219 calls (driver 1,023, SST 148, DEMO-AC-008 20, the runner's own 14), at most 253 in any 5 minutes, no 429s. Pulumi provider calls were not counted.
- **D1, for the day:** 892 rows written and 3,676 read.

**Account after the run**
- Stages: `prodcheck`, the demo stage and the mail sink.
- Tokens: `admin`, `Read-all`, `prototype-r2-signing`, and three `compliance-r2read-*` tokens that expire by 01:46Z. No `prototype-compliance-*` token remains.
