# KV

Read this when you need to store small text values by key: a per-user setting, a status line, a flag, a short cached result. For records you query, filter or join, use SQL instead ([sql-and-migrations.md](sql-and-migrations.md)).

## Operations

`c.var.kv` (type `KvService`):

| Call | Does |
| --- | --- |
| `await kv.get(key)` | The stored string, or `null` when the key is absent |
| `await kv.put(key, value)` | Creates or replaces the value |
| `await kv.delete(key)` | Removes the key; deleting an absent key succeeds |
| `await kv.list(prefix, { limit?, cursor? })` | `{ items: [{ key, value }], nextCursor }` for keys starting with `prefix`, in code point order |

- Keys: non-empty Unicode text, at most 1,024 UTF-8 bytes (PAR-220); otherwise 400 `KV.INVALID_KEY`.
- Values: Unicode text, at most 4,096 UTF-8 bytes (PAR-223); larger is 413 `KV.VALUE_TOO_LARGE`. The empty string is a value. Store structured data with `JSON.stringify` and validate it with Zod when you read it back. Anything bigger belongs in SQL or files.
- Entries never expire. To expire something, store the expiry time in the value and check it when you read.
- The prefix is literal and case-sensitive; an empty prefix lists every key.
- `list` returns 20 items by default (PAR-221) and at most 50 (PAR-222). `nextCursor` is `null` when nothing is left; otherwise pass it as `cursor` with the **same prefix** to get the next page. A cursor for another prefix, or a made-up one, is 400 `KV.INVALID_CURSOR`. Listing unchanged data page by page returns every key exactly once.
- An unusable store is 503 `KV.UNAVAILABLE` (logged by the framework). Let it propagate.

KV behaves identically on every target; you never see where it is stored.

## Keys

- Build keys on the server from values you trust: a fixed prefix plus IDs, for example `status:${c.var.user.id}`. Never use raw user input as a whole key; that would let one user read or overwrite another's entries.
- Use a prefix per kind of entry (`status:`, `pref:<userId>:`), so `list` can read one kind at a time.
- When a value's key is user-chosen text, validate it with Zod (length, allowed characters) before putting it in a key.

## Testing

`createTestApp` gives each test app empty storage. `createTestApp(app, { unavailable: ["kv"] })` makes every KV call fail with `KV.UNAVAILABLE`, to test how your route answers. See [testing.md](testing.md).

## Examples

- [examples/status-kv.md](../examples/status-kv.md): one status line per user, read and written by the browser.

## Stopping condition

Stop reading when every key your code builds has a fixed prefix plus trusted IDs, values stay under 4,096 bytes, `list` callers pass the cursor back with the same prefix, and `npx prototype-framework verify` passes.
