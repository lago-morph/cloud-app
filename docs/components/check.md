# CHECK — Static checks

Executable portability rules for app code, and the migration checker. These are what make SYS-REQ-006 ("enforced, not remembered") real; the verification command runs them (CLI).

Contracts: rule names and diagnostics below. Configuration is provided by `./check`.

## 1. Requirements

#### CHECK-REQ-001 — Portability rules
Origin: owner-approved · Derives from: SYS-REQ-004, SYS-REQ-006, SYS-REQ-011

The rules below MUST run on all app code. They MUST resolve aliases, re-exports, and dynamic imports rather than relying on identifier spelling.

| Rule | Rejects |
| --- | --- |
| `allowed-imports` | Imports of platform SDKs, database drivers, Drizzle dialect modules, or framework subpaths outside CORE-REQ-005's table. |
| `no-env-access` | Reading `process.env`, platform bindings, or `import.meta.env` in app code. |
| `no-raw-sql` | Raw SQL and low-level database execution APIs. |
| `no-dialect-features` | Query features outside SQL-REQ-002, including inside subqueries and common table expressions. |
| `framework-order` | Ordering other than the framework's `asc` and `desc`. |
| `no-transactions` | `.transaction()` and `.batch()`; use `atomic`. |
| `no-relational-queries` | Drizzle's relational `db.query` API. |
| `framework-ids` | ID values not from `newId()`, and updates to `id()` columns. |

#### CHECK-REQ-002 — No type escapes
Origin: ai-proposed · Derives from: SYS-REQ-006

App code MUST NOT use `any`, unchecked type assertions, or comments that suppress type or lint errors (DEC-0043). Generated entry points and tooling have explicit, narrow exemptions.

#### CHECK-REQ-003 — Actionable diagnostics
Origin: provenance-unclear · Derives from: SYS-REQ-006, SYS-REQ-029

Each diagnostic MUST name the offending construct, the rule, and the skill reference to read.

#### CHECK-REQ-004 — Migration checker
Origin: provenance-unclear · Derives from: SYS-REQ-011, SYS-REQ-012

The checker MUST enforce MIG-REQ-001 and MIG-REQ-003:
- both dialect histories yield the same logical schema;
- only portable changes are used;
- applied migrations are unchanged.

#### CHECK-REQ-005 — Fixtures
Origin: provenance-unclear · Derives from: SYS-REQ-006

Every rule MUST have failing fixtures and realistic passing fixtures, and the template and demo code MUST pass.

## 2. Design

The rules are ESLint rules using TypeScript type information, exported with a ready configuration from `./check`. The migration checker applies both histories to fresh local D1 and PGlite databases, then compares their introspected schemas.

Static rules cannot prove arbitrary behavior. They are narrow by design and are backed by the compliance suite.

## 3. Uses

CORE (export list), SQL (supported subset), MIG (migration rules), SKILL (reference names in diagnostics).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| CHECK-AC-001 | Each rule fails its failing fixtures, including aliased and re-exported variants, and passes its passing fixtures. | CHECK-REQ-001 | Local |
| CHECK-AC-002 | Fixtures using `any`, `as` casts to unrelated types, and `@ts-ignore` / `eslint-disable` comments fail. | CHECK-REQ-002 | Local |
| CHECK-AC-003 | Every rule's diagnostic names its construct, rule, and an existing skill reference. | CHECK-REQ-003 | Local |
| CHECK-AC-004 | Mismatched dialect histories, an unportable change, and an edited applied migration each fail the checker. | CHECK-REQ-004 | Local |
| CHECK-AC-005 | The template and demo pass all rules. | CHECK-REQ-005 | Local |
