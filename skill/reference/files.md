# Files

Read this when users upload or download files (images, documents, exports), or server code stores or reads whole files.

File content never passes through the API: the browser sends it to storage and fetches it from storage directly, using a short-lived **ticket** that your server issues after it has decided the user may do this. So there is no API size limit on files (single uploads up to about 5 GB, PAR-234).

## Server operations

`c.var.files` (type `FilesService`):

| Call | Does |
| --- | --- |
| `await files.createUploadTicket(name, { contentType })` | Permission for the browser to create or replace `name`; the upload must declare exactly `contentType` (default `application/octet-stream`) |
| `await files.createDownloadTicket(name)` | Permission for the browser to download `name`; 404 `FILES.NOT_FOUND` if it does not exist |
| `await files.head(name)` | `{ name, size, contentType }`, or `null` |
| `await files.get(name)` | The same plus `body` (a `ReadableStream<Uint8Array>`), or `null`. For server-side processing only |
| `await files.put(name, bytes, { contentType? })` | Creates or replaces a whole file from a `Uint8Array` |
| `await files.delete(name)` | Removes it; deleting an absent file succeeds |
| `await files.list(prefix, { limit?, cursor? })` | `{ items: [{ name, size, contentType }], nextCursor }`, names starting with `prefix` in code point order; 100 per page by default, at most 1,000 |

- Names are opaque text: non-empty, at most 1,024 UTF-8 bytes (PAR-230), no control characters; otherwise 400 `FILES.INVALID_NAME`. A `/` in a name is just a character; nothing is a path.
- A list cursor works only with the prefix it came from; otherwise 400 `FILES.INVALID_CURSOR`.
- Unreachable storage is 503 `FILES.UNAVAILABLE` (logged by the framework).
- Return the ticket to the browser as JSON (`return c.json({ ticket })`). Its contents are not yours to read or build.
- A ticket can be used repeatedly until it expires after 15 minutes (PAR-233), and only for its own operation and name.

## The safe upload pattern

1. **The server picks the name.** Never use a name the browser sends as a storage name as-is. Build it from trusted parts: a record-scoped `newId()` prefix (`attachments/<recordId>/<newId()>`) or the user's own folder plus a validated plain name. Decide who may read or write a file from your own SQL records, never from the file name.
2. **Issue the upload ticket with an explicit content type**, from a guarded route that validates its input.
3. **The browser calls `uploadFile(ticket, file, { onProgress })`**.
4. **A finalize route** (called by the browser after `uploadFile` resolves) calls `files.head(name)`, deletes the file with `files.delete(name)` if it is missing, too large, or of a type you do not accept, and only then creates the record that makes the file visible (for example an `attachments` row). Until then, nothing lists or links the file.

The template does all four steps: [examples/files-tickets.md](../examples/files-tickets.md) has the routes (an `uploads` table, `uploads/<userId>/<newId()>` names, a finalize route that rejects files over 10 MiB or of an unaccepted type with `HTTP.CONFLICT`) and the browser page, and [examples/tests.md](../examples/tests.md) has their tests. Copy it and change the limits and the record to fit your app.

## Downloads

- Each time you list files for the browser, fetch fresh download tickets (or fetch one when the user clicks). Never store or cache download URLs: they expire.
- The browser uses `downloadUrl(ticket)` as a link, in `window.open`, or as `<img src>`. A download is saved under the file's whole name; raster images (`image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif`, `image/bmp`) are shown inline.
- **File content reaches the browser only through `downloadUrl`.** Never return `files.get` content from an API route: large files would fail on some clouds. Use `files.get` only to process a file on the server.

## Browser helpers

From `@lago-morph/prototype-framework/client`:

- `uploadFile(ticket, blob, { onProgress? })` sends one upload with the ticket's content type. If the Blob has a non-empty `type` that differs from the ticket's, it is refused before sending. So ask for the ticket with `file.type`, or `application/octet-stream` when `file.type` is empty, as the template does.
- `downloadUrl(ticket)` returns a URL valid for the ticket's lifetime.
- A transfer that does not complete throws `ApiError` with `FILES.TRANSFER_FAILED`; `status` is storage's HTTP status when the browser could read one, otherwise `null`. The message names the class: `no response: network or cross-origin blocked`, `rejected by storage (HTTP n)`, `interrupted after n bytes`, or `content type does not match ticket`. Retry with a fresh ticket.

Platform note (not yet verified on Cloudflare in this phase: seen in a spike, not in a framework run): on Cloudflare, storage sends no cross-origin headers with its refusals, so an expired or mismatched ticket is reported there with `status: null` and the `no response` message instead of storage's status. This differs from the other targets and is an open owner item (DEC-0101); do not branch on the status of a failed transfer.

## Testing

Under `createTestApp`, tickets point to a local framework route, so routes that issue tickets can be tested in-process: an upload ticket request answers 200 with a `ticket`, and a download ticket for a missing file answers 404 `FILES.NOT_FOUND`. `unavailable: ["files"]` makes every operation fail with `FILES.UNAVAILABLE`. See [testing.md](testing.md).

## Examples

- [examples/files-tickets.md](../examples/files-tickets.md): the whole upload pattern: tickets, the finalize route with `head` and `delete`, a listing from records, and the browser page with progress.

## Stopping condition

Stop reading when your server builds every file name itself, authorizes from your records, issues tickets with explicit content types, checks uploads with `head` before making them visible, serves content only through `downloadUrl`, and `npx prototype-framework verify` passes.
