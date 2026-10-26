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

- Names are opaque text: non-empty, at most 1,024 UTF-8 bytes (PAR-230), not exactly `.`, no `/`-separated part that is exactly `..` (so `..`, `../x`, `a/../b` and `a/..` are refused; `notes..txt` and `.hidden` are fine), no control characters; otherwise 400 `FILES.INVALID_NAME`. A `/` in a name is just a character; nothing is a path.
- A list cursor works only with the prefix it came from; otherwise 400 `FILES.INVALID_CURSOR`.
- Unreachable storage is 503 `FILES.UNAVAILABLE` (logged by the framework).
- Return the ticket to the browser as JSON (`return c.json({ ticket })`). In app code its contents are not yours to read or build; tests may read it (see Testing).
- A ticket can be used repeatedly until it expires after 15 minutes (PAR-233), and only for its own operation and name.

## The safe upload pattern

1. **The server picks the name.** Never use a name the browser sends as a storage name as-is. Build it from trusted parts: a record-scoped `newId()` prefix (`attachments/<recordId>/<newId()>`) or the user's own folder plus a validated plain name. Decide who may read or write a file from your own SQL records, never from the file name.
2. **Issue the upload ticket with an explicit content type**, from a guarded route that validates its input.
3. **The browser calls `uploadFile(ticket, file, { onProgress })`**.
4. **A finalize route** (called by the browser after `uploadFile` resolves) calls `files.head(name)`, deletes the file with `files.delete(name)` if it is missing, too large, or of a type you do not accept, and only then creates the record that makes the file visible (for example an `attachments` row). Until then, nothing lists or links the file.

The template does all four steps: [examples/files-tickets.md](../examples/files-tickets.md) has the routes (an `uploads` table, `uploads/<userId>/<newId()>` names, a finalize route that rejects files of an unaccepted type with `HTTP.CONFLICT`) and the browser page, and [examples/tests.md](../examples/tests.md) has their tests. The template sets no size cap of its own: uploads are limited only by storage's single-upload maximum (PAR-234: about 5 GB; on Cloudflare R2, 4.995 GiB). Copy it and change the accepted types, add a size limit only if your app needs one, and change the record to fit your app.

## Downloads

- Each time you list files for the browser, fetch fresh download tickets (or fetch one when the user clicks). Never store or cache download URLs: they expire.
- The browser uses `downloadUrl(ticket)` as a link, in `window.open`, or as `<img src>`. PNG, JPEG, GIF and WebP files open in the browser (`inline`, served from storage's own origin on a cloud); every other type, SVG and HTML included, is saved as a download. Either way the file keeps its whole name. On a cloud, the browser ignores a link's `download` attribute (the URL is on another origin), so a link to a PNG opens it rather than saving it.
- **File content reaches the browser only through `downloadUrl`.** Never return `files.get` content from an API route: large files would fail on some clouds. Use `files.get` only to process a file on the server.

## Browser helpers

From `@lago-morph/prototype-framework/client`:

- `uploadFile(ticket, blob, { onProgress? })` sends one upload with the ticket's content type. If the ticket has expired (by the browser's clock), or the Blob has a non-empty `type` that differs from the ticket's, it is refused before sending. So ask for the ticket with `file.type`, or `application/octet-stream` when `file.type` is empty, as the template does.
- `downloadUrl(ticket)` returns a URL valid for the ticket's lifetime.
- A transfer that does not complete throws `ApiError` with `FILES.TRANSFER_FAILED`; `status` is storage's HTTP status when the browser could read one, otherwise `null`. The message names the class: `no response: network or cross-origin blocked`, `rejected by storage (HTTP n)`, `interrupted after n bytes`, `content type does not match ticket`, or `rejected before sending: …` (`ticket expired`, `not an upload ticket`, `not a download ticket`). Retry with a fresh ticket.

Platform note: on Cloudflare, each file is stored in R2 under its name followed by an invisible U+0001 character (a name of exactly 1,024 bytes has none), so that listings come back in code point order. Your code always sees plain names and never needs the ending. Only when you look in the R2 dashboard, or use `wrangler r2 object get` or an S3 tool on the bucket, does the key carry it: a lookup by the plain name finds nothing there, and S3 listings need `encoding-type=url`.

Platform note (not yet verified on Cloudflare in this phase: seen in a spike, not in a framework run): on Cloudflare, storage sends no cross-origin headers with its refusals, so a mismatched ticket is reported there with `status: null` and the `no response` message instead of storage's status. Expired tickets are caught before sending on every target. Do not branch on the status of a failed transfer.

## Testing

Under `createTestApp`, tickets point to a local framework route, so routes that issue tickets can be tested in-process: an upload ticket request answers 200 with a `ticket`, and a download ticket for a missing file answers 404 `FILES.NOT_FOUND`. `unavailable: ["files"]` makes every operation fail with `FILES.UNAVAILABLE`; `t.setUnavailable(["files"])` does the same from the next request on, after the test has stored files ([testing.md](testing.md)).
The ticket is the same JSON on every target: `{ url, method?, headers?, expiresAt }`. Only `url` differs: a path on the app locally and in-process, an absolute signed storage URL on a cloud. A test that sends a ticket itself (as the smoke test does on a stage) sends a path on the app with `t.request`, and an absolute storage URL with plain `fetch(url, { method, headers, body })`, never through `t.request` or another test helper: the test app refuses other origins, so the stage's session cookie never reaches storage. See "The smoke test" in [testing.md](testing.md).

## Examples

- [examples/files-tickets.md](../examples/files-tickets.md): the whole upload pattern: tickets, the finalize route with `head` and `delete`, a listing from records, and the browser page with progress.

## Stopping condition

Stop reading when your server builds every file name itself, authorizes from your records, issues tickets with explicit content types, checks uploads with `head` before making them visible, serves content only through `downloadUrl`, and `npm run verify` passes.
