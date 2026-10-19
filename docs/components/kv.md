# KV — Key-value storage

Storage of string values by string key, with listing by key prefix.

Contracts: [kv.d.ts](../contracts/ts/kv.d.ts), [errors.d.ts](../contracts/ts/errors.d.ts) (`KV.*`).

## 1. Requirements

#### KV-REQ-001 — Operations
Origin: owner · Derives from: SYS-REQ-013

The operations behave as follows:
- `get` returns the stored string, or null for an absent key.
- `put` creates or replaces the value.
- `delete` of an absent key succeeds.
- `list` returns the entries (key and value) whose keys start with the prefix, which is literal and case-sensitive, in key code point order.

Entries do not expire (DEC-0051).

#### KV-REQ-002 — Keys and values
Origin: provenance-unclear · Derives from: SYS-REQ-013

Keys and prefixes MUST be well-formed Unicode text. Keys MUST be non-empty and at most PAR-220 bytes in UTF-8; anything else is rejected with `KV.INVALID_KEY`. Values MUST be well-formed Unicode text of at most PAR-223 bytes in UTF-8; anything else is rejected with `KV.VALUE_TOO_LARGE`, or with `KV.INVALID_KEY` for a malformed string.

#### KV-REQ-003 — Pagination
Origin: provenance-unclear · Derives from: SYS-REQ-013

`list` pages hold PAR-221 items by default and at most PAR-222. The cursor is opaque and valid only for the prefix it was issued for; anything else is rejected with `KV.INVALID_CURSOR`. Listing unchanged data page by page MUST return every matching key exactly once.

#### KV-REQ-004 — Same behavior everywhere
Origin: owner · Derives from: SYS-REQ-001, SYS-REQ-013

KV MUST behave identically on every target.

#### KV-REQ-005 — Own failure codes
Origin: owner-approved · Derives from: SYS-REQ-005, SYS-REQ-010

When its storage cannot be used, KV MUST fail with `KV.UNAVAILABLE`. Failures of the storage behind it MUST NOT surface under another component's codes.

## 2. Design

KV is stored in a framework table in the app's SQL database, `__framework_kv(key text primary key, value text)` (DEC-0010). This is a simplification, not part of the contract. Prefix listing uses a key range (`key >= prefix AND key < prefix-successor`), not `LIKE`. The cursor encodes the prefix and the last key returned. PAR-220, PAR-222, and PAR-223 are chosen so that a maximum page (PAR-222 × (PAR-220 + PAR-223)) stays within the portable SQL result limit (PAR-215). SQL failures are mapped to `KV.UNAVAILABLE`.

The local, Cloudflare, and AWS adapters are the SQL adapters for each target; KV needs no target-specific code.

## 3. Uses

SQL, MIG (framework table migrations).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| KV-AC-001 | Put, overwrite, get, missing-key get, delete, and repeated delete behave as specified; list returns exactly the keys that literally match the prefix, including keys containing `%`, `_`, and mixed case. | KV-REQ-001 | Local, cloud |
| KV-AC-002 | Empty, oversized, and malformed keys and values are rejected with the specified codes; a key of exactly PAR-220 bytes and a value of exactly PAR-223 bytes are accepted. | KV-REQ-002 | Local, cloud |
| KV-AC-003 | Listing 2.5 pages of keys returns each key once; a cursor used with a different prefix is rejected. | KV-REQ-003 | Local, cloud |
| KV-AC-004 | The KV suite produces identical results on local D1, PGlite, Cloudflare, and AWS. | KV-REQ-004 | Local, cloud |
| KV-AC-005 | Locally, with the database unreachable, KV operations fail with `KV.UNAVAILABLE`. On every target, a maximum page of maximum-size entries lists successfully. | KV-REQ-005 | Local, cloud |

## 5. Portability note

Any key-value or SQL store can back this contract. Replacing the SQL table with a native key-value service changes only this component's adapter.
