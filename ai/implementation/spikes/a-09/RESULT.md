# A-09 — `sql.d.ts` typing approach (restricted Drizzle pg-core types)

> **Code and logs archived.** This spike's scripts, `logs/` and `out/` are on branch `archive/implement-local-cloudflare`, in the same directory (see ARCHIVE-INDEX.md there, and `ai/ARCHIVE.md`). The relative paths below resolve on that branch.

## Question

Does the `docs/contracts/ts/sql.d.ts` typing approach (framework `Table`/`Column` aliases of
restricted Drizzle pg-core types, `PortableDb = Pick<PgDatabase<PortableQueryResult>, …>`)
type-check the sql.md §2.3 CRUD example, including `.returning({ id })`, `atomic` tuple typing,
and a wrong-type insert failing? If not, which declarations need to change?

## Setup

- Node 22.22.0, npm 10.9.4. `drizzle-orm` 0.45.4 (PAR-102), `typescript` 5.9.3 (PAR-111 is not
  yet pinned; A-10 picks it). Cross-checked with TypeScript 7.0.2 via `npx -p typescript@7.0.2`.
- `fw/index.d.ts` — verbatim copy of `docs/contracts/ts/sql.d.ts` (the contract as it is).
- `fw-revised/index.d.ts` — the same file with the candidate changes; full diff in `revised.diff`.
- `tsconfig.json` maps `@lago-morph/prototype-framework` to `fw/`; `tsconfig.revised.json` maps it
  to `fw-revised/`. `strict: true`, `NodeNext`, `skipLibCheck: true` (Drizzle 0.45.4's own
  `.d.ts` files have errors for gel/mysql/Buffer without their peer types, so `skipLibCheck` is
  needed in any consumer; the contract files were checked separately, see below).
- `src/example.ts` — the sql.md §2.3 example verbatim, only `"<package>"` replaced.
- `src/checks.ts` — exact-type assertions (`Equal<…>`) and negative cases with
  `// @ts-expect-error` (each MUST error, otherwise tsc reports TS2578).
- `src/baseline-native.ts` — the same left join on native `pgTable` tables, as a baseline.

## Commands and raw output

```
$ cd ai/implementation/spikes/a-09 && npm install
$ npx tsc -p tsconfig.example.json        # §2.3 example only, contract as is
EXIT 0

$ npx tsc -p tsconfig.json                # all checks, contract as is
src/checks.ts(89,43): error TS2322: Type 'Table<{ readonly id: ColumnBuilder<string, false, false>; readonly notebookId: … }>' is not assignable to type 'Table<ColumnBuilders>'.
  … is not assignable to type '{ [x: string]: Column<unknown, boolean, boolean>; }'.
    Index signature for type 'string' is missing in type 'PgTable<{ name: string; … }> & { … } & { … }'.
src/checks.ts(89,50): error TS2322: Type 'Table<{ readonly id: …; readonly name: … }>' is not assignable to type 'Table<ColumnBuilders>'.  (same chain)
src/checks.ts(123,10): error TS2344: Type 'false' does not satisfy the constraint 'true'.
src/checks.ts(128,10): error TS2344: Type 'false' does not satisfy the constraint 'true'.
src/checks.ts(130,10): error TS2344: Type 'false' does not satisfy the constraint 'true'.

$ npx tsc -p tsconfig.revised.json        # all checks, revised contract
EXIT 0

$ npx -y -p typescript@7.0.2 tsc -p tsconfig.json          # same 5 errors (89,43 89,50 123,10 128,10 130,10)
$ npx -y -p typescript@7.0.2 tsc -p tsconfig.revised.json  # EXIT 0

$ npx tsc -p tsconfig.json --skipLibCheck false 2>&1 | grep -v '^ ' | grep -v '^node_modules'
  → only the 5 src/checks.ts errors above; none in fw/index.d.ts (same for fw-revised: none)
```

Line meanings: 89 = `const tables: TableDefinitions = { notes, notebooks }` (the `tables` record of
`defineApp`, core.d.ts `AppDefinition.tables`); 123 = left join result type; 128/130 = `sum`/`avg`
result types.

Probe of the left join under the original contract (temporary file, removed):
```
error TS2322: Type '{ t: never; nb: never; }[]' is not assignable to type 'number'.
```
Native Drizzle baseline (same query): `{ t: string; nb: string | null; }[]`.

Every `@ts-expect-error` was also checked with the directive stripped, to confirm it fails for the
intended reason (both contracts give the same errors on these lines):
```
55  Property 'select' does not exist on type 'WriteDb'.            (atomic step uses select)
61  Type 'number' is not assignable to type 'string | SQL<unknown> | Placeholder<string, any>'.   (title: 42)
63  Property 'createdAt' is missing in type '{ id; notebookId; title }' but required …
65  Type 'null' is not assignable to type 'string | SQL<unknown> | Placeholder<string, any>'.     (title: null)
67  Object literal may only specify known properties, and 'extra' does not exist …
69  Type 'string' is not assignable to type 'number | SQL<unknown> | PgColumn<…> | undefined'.   (set views: "many")
71  No overload matches this call (eq(notes.createdAt, "yesterday"))
73  Argument of type 'Column<number, …>' is not assignable to parameter of type 'Column<string, …>'.   (containsText on integer)
82  Type '"nope"' is not assignable to type '"id" | "n" | "flag"'.   (index on unknown key)
85  Argument of type 'string' is not assignable to parameter of type 'number'.   (integer().default("zero"))
87  Type 'Column<number, …>' is not assignable to type 'Column<string, false, boolean, string>'.   (ref to non-text)
95  Type 'Column<number, …>' is not assignable to type 'Column<string>'.
100–108  Property 'execute' / 'transaction' / 'query' / '$count' / 'refreshMaterializedView' does not exist on type 'PortableDb'.
110 Property 'select' does not exist on type 'WriteDb'.
```

## What works with the contract as it is

- The §2.3 example type-checks unchanged (`tsconfig.example.json`, exit 0), with exact types:
  row type `{ id: string; notebookId: string; title: string; body: string | null; views: number; createdAt: number }`;
  insert type with `body`, `views` optional; `example()` returns
  `{ recent: { id: string; title: string; body: string | null }[]; found: boolean }`.
- `.returning({ id: notes.id })` → `{ id: string }[]`; `.returning()` → full row array;
  writes without `returning()` → `void` (via `PortableQueryResult`).
- `atomic` tuple typing: `[insert, update…returning({id}), delete…returning()]` →
  `[void, { id: string }[], NoteRow[]]`; `atomic(db, [])` → `[]`; a step using `select` fails.
- Wrong-type inserts/updates/comparisons fail (list above); disallowed members (`execute`,
  `transaction`, relational `query`, `$count`, `refreshMaterializedView`) are absent from
  `PortableDb`; `WriteDb` has no `select`.
- Inner joins, `limit`/`offset`, framework `asc`/`desc`, `$with` + `with`, `onConflictDoUpdate`
  against a unique column, `onConflictDoNothing`, `count`, `max(timestamp)` all type-check with
  precise result types.

## What fails with the contract as it is (3 defects)

1. **`TableDefinitions` rejects every defined table.** `Table<Cols>` for a concrete table is not
   assignable to `Table<ColumnBuilders>` (the default): the mapped `columns` of the default has a
   string index signature that the intersection type `PgTable<…> & {…}` lacks. Since
   `AppDefinition.tables: TableDefinitions` (core.d.ts), `defineApp({ tables: { notes } })` would
   not compile.
2. **Left joins give `never` for every selected field.** `Table` fixes `name: string` and `Column`
   fixes `tableName: string`. Drizzle keys join nullability by the literal table name; with `string`
   the map becomes `{[x: string]: 'not-null'} & {[x: string]: 'nullable'}` → `never`. Inner joins
   happen to work ('not-null' & 'not-null'). sql.md §2.3 lists left joins as supported.
3. **`sum`/`avg` are typed `string | null`.** The contract re-exports Drizzle's signatures, but
   binding SQL-REQ-003 says they return JS numbers (the framework normalises at runtime). Apps would
   see a `string` type for a `number` value.

## Revised declarations (all checks pass, TS 5.9.3 and 7.0.2) — see `revised.diff`

- `Column<T, Nullable, HasDefault, TableName extends string = string>` with `tableName: TableName`.
- `Table<Cols, Name extends string = string>` with `name: Name` and columns `Column<T, N, D, Name>`.
- `defineTable<const Name extends string, const Cols …>(name: Name, …): Table<Cols, Name>`.
- New `AnyTable = PgTable` ("any defined table"); `TableDefinitions = Record<string, AnyTable>`.
  (Would also need adding to the re-export list in `docs/contracts/ts/index.d.ts`.)
- `sum`/`avg` declared by the framework: `(expression: SQLWrapper) => SQL<number | null>` instead
  of re-exporting Drizzle's; `count`, `countDistinct`, `min`, `max` stay re-exported.

Not tested: aliased self-joins (`alias()` is not exported by the contract), subqueries in `where`
beyond the CTE, upsert typing against a multi-column `uniques` entry (no Drizzle target type for it
in a framework `Table`).

## Verdict

**Approach works; the contract as written does not fully.** The §2.3 CRUD example, `.returning({ id })`,
`atomic` tuple typing and wrong-type-insert failures all type-check as designed with the contract
unchanged. But three declarations are defective (`TableDefinitions`, left-join nullability via
`string` table names, `sum`/`avg` result types). The design names no fallback (plan: "none — ask
owner", contract change), so the revised declarations above are a **proposal for the owner**; the
contract in `docs/contracts/ts/sql.d.ts` was not changed. B-05 should wait for the owner's answer.

No cloud resources were used; nothing left over.
