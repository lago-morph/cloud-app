# FILES — Files

Named binary files: server-side operations, and browser uploads and downloads that the app's server authorizes and the framework carries out.

Contracts: [files.d.ts](../contracts/ts/files.d.ts) (server), [client.d.ts](../contracts/ts/client.d.ts) (`uploadFile`, `downloadUrl`), [errors.d.ts](../contracts/ts/errors.d.ts) (`FILES.*`).

## 1. Requirements

#### FILES-REQ-001 — Server operations
Origin: owner · Derives from: SYS-REQ-014

The server operations behave as follows:
- `put` creates or replaces a whole file.
- `get` and `head` return null for an absent file.
- `delete` of an absent file succeeds.
- `list` returns files whose names start with the prefix (literal) in code point order, with pagination behaving like KV-REQ-003 (PAR-231, PAR-232) and `FILES.INVALID_CURSOR` for a bad cursor.

The content type defaults to `application/octet-stream`.

#### FILES-REQ-002 — Names
Origin: provenance-unclear · Derives from: SYS-REQ-014

File names are opaque. They MUST be non-empty, well-formed Unicode text, at most PAR-230 bytes in UTF-8, and MUST NOT contain U+0000–U+001F or U+007F; anything else is rejected with `FILES.INVALID_NAME`. Names MUST NOT be interpreted as filesystem paths.

#### FILES-REQ-003 — Browser transfers
Origin: owner · Derives from: SYS-REQ-008, SYS-REQ-014

The browser MUST be able to upload and download files using tickets created by app server code, with no limit imposed by the framework or by compute request-size limits. Each ticket:
- permits only its stated operation (upload or download) on its stated name;
- may be used repeatedly until it expires after PAR-233;
- for uploads, requires the content type the ticket names.

Files up to the storage platform's single-upload maximum (PAR-234) are supported.

#### FILES-REQ-004 — Hidden mechanism
Origin: owner · Derives from: SYS-REQ-005, SYS-REQ-008

App code MUST NOT see storage services, signing, credentials, or cross-origin configuration; tickets are opaque types with no readable fields. Any cross-origin access storage needs for transfers MUST be configured by the framework and limited to the stage's public origin (DEC-0058).

#### FILES-REQ-005 — Private storage
Origin: provenance-unclear · Derives from: SYS-REQ-008

Stored files MUST NOT be publicly readable or writable except through valid tickets.

#### FILES-REQ-006 — Failures
Origin: owner-approved · Derives from: SYS-REQ-010

Unreachable storage MUST surface as `FILES.UNAVAILABLE`. When a browser transfer does not complete, for any reason including an expired ticket or an upload rejected before sending, the browser helpers MUST throw `ApiError` with `FILES.TRANSFER_FAILED`. Its `status` MUST be storage's HTTP status when one was received, and null otherwise. Its message MUST name the failure class (`no response: network or cross-origin blocked`, `rejected by storage (HTTP n)`, `interrupted after n bytes`, or, for an upload rejected before sending, `content type does not match ticket`) and MUST NOT include storage's error body.

## 2. Design

**Tickets** carry what the browser needs to perform one HTTP request directly against storage:
- an upload ticket holds a URL, the HTTP method, the required headers, and an expiry time;
- a download ticket holds a URL and an expiry time.

`uploadFile` sends one `PUT` with progress reporting. It always sends the ticket's content type; a Blob whose non-empty `type` differs is rejected before sending. `downloadUrl` returns the URL, which works in `<img src>` and links. A signed URL carries a signature and, on AWS, the temporary credential's key ID and session token, but never a signing secret: it can perform only its own operation until it expires (DEC-0062). One `PUT` covers files up to PAR-234; multipart uploads are not used (DEC-0062). An app that cares about upload size or type can check `head` after the upload.

**Safe upload pattern.** The pattern apps are taught (SKILL):
1. The server generates the file name (for example a record-scoped `newId()` prefix) and decides access from app records, never from names. It issues the upload ticket with an explicit content type.
2. The browser calls `uploadFile`.
3. A finalize route calls `head`, deletes uploads that are oversized or of the wrong type, and only then creates the visible record.

Fetch fresh download tickets with each listing; do not cache URLs.

**Shared runtime shape** (DEC-0160, DEC-0162, DEC-0164):
- One target-neutral service runs over the object store (the R2 Worker binding, locally and on Cloudflare), with a ticket issuer supplied by each target.
- Both kinds of ticket are plain JSON with `url` and `expiresAt` (milliseconds). An upload ticket also holds `method` (`PUT`) and `headers` (always `Content-Type`). The browser helpers read only these fields, so they behave the same on every target.
- A `list` cursor encodes the prefix and the last name returned. The next page asks the store for names after that name, and the service fills each page to its limit even when the store returns short pages. A `limit` is clamped to 1…PAR-232.
- Every store failure that is not already a `FrameworkError` becomes `FILES.UNAVAILABLE` and is logged once. `createUploadTicket` asks the store for the name's metadata first, so it also fails when storage is unreachable.

**Cross-origin configuration.** The bucket's CORS policy (the rules a browser checks before cross-origin requests) is set by provisioning. It allows `PUT` and `GET` from the stage's public origin only, with the `Content-Type` request header. App code and app configuration never touch it.

### Local
Server operations use the local R2 emulation through its Worker binding. Tickets point to a same-origin framework route, `/api/__framework/files/*`, which checks an HMAC-signed ticket and streams the body to or from local storage. Its responses always carry `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`, plus `Content-Disposition: attachment` for content types other than raster images, so uploaded HTML or SVG never runs as the app's origin. There is no cross-origin traffic and no use of Wrangler's experimental local S3 endpoint.

Implementation details (DEC-0161, DEC-0163):
- A local ticket's URL is the relative path `/api/__framework/files/<token>`. The token is base64url JSON of operation, name, content type (uploads) and expiry time, followed by `.` and its HMAC-SHA-256 signature. The signing key is the framework-internal local secret that `dev` generates into `.dev.vars` (SEC).
- The route accepts `PUT` with an upload ticket and `GET` with a download ticket. An upload must send exactly the ticket's `Content-Type`.
- A ticket that is malformed, tampered with, expired, used for the other operation, or used with a different content type gets an empty 403. A download of a file deleted after the ticket was issued gets an empty 404. These refusals are not logged, so ticket URLs never reach the log.
- The route sends no CORS headers, so other origins cannot use it. "Raster images" means `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif` and `image/bmp`.
- The route reads an upload body completely before storing it. R2's binding accepts only streams of known length, and a request body in the Node process of `createTestApp` is not one. This is local only, so the limit is the machine's memory, not a framework limit.
- The route, its tickets and the key's name live only in `src/files/local/`. Nothing else in FILES imports them, so cloud bundles can leave them out (CORE-REQ-006).

### Cloudflare
Server operations use the R2 Worker binding. Tickets are SigV4-signed URLs for R2's S3-compatible endpoint, created with aws4fetch (PAR-105), because the binding cannot sign URLs. The signing credentials are an R2 API token scoped to the stage's bucket. Provisioning creates it and stores it as a framework-internal Worker secret.

Note: R2 sends no CORS headers on its 403 responses (expired or mismatched ticket), so the browser cannot read storage's status there; on Cloudflare such a transfer fails with status null and the `no response: network or cross-origin blocked` message. This conflicts with FILES-AC-003's expired-ticket clause and is an open owner item: see DEC-0101.

### AWS
Server operations and tickets use S3 with the Lambda's role credentials, including the session token, through aws4fetch. Tickets last PAR-233, on the assumption that role sessions outlast it; a ticket whose credentials expire early fails in the browser with `FILES.TRANSFER_FAILED` and storage's status. Lambdas access S3 directly, outside any VPC. File content reaches the browser only through `downloadUrl`, never as an API route's response body: Lambda buffers responses and refuses those above its response payload limit, so a route returning a `files.get` stream fails on AWS for large files.

## 3. Uses

HTTP (local transfer route; app routes that hand out tickets), CFG (bucket identifiers and public origin), SEC (R2 signing credentials), LOG.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| FILES-AC-001 | Binary round trip with byte-exact content and metadata; overwrite, missing `get`/`head`, repeated delete; list across several pages with exact names. | FILES-REQ-001 | Local, cloud |
| FILES-AC-002 | Names with spaces, `%`, `/`, `..`, and non-ASCII characters round-trip unchanged; empty and oversized names, and names containing CR, LF, or NUL, are rejected with `FILES.INVALID_NAME`. | FILES-REQ-002 | Local, cloud |
| FILES-AC-003 | In a real browser on each target, a 20 MB file uploads through `uploadFile` and downloads through `downloadUrl` byte-exact. A ticket for one name cannot write another. An upload with a different content type is rejected, and `uploadFile` rejects a Blob whose non-empty `type` differs from the ticket's before sending, with `FILES.TRANSFER_FAILED`, status null, and a `content type does not match ticket` message. An expired ticket fails with `FILES.TRANSFER_FAILED`, storage's status, and a `rejected by storage (HTTP n)` message without storage's error body. | FILES-REQ-003, FILES-REQ-006 | Local, cloud |
| FILES-AC-004 | Contract and type inspection finds no storage-service names or credentials in app-facing types. A transfer attempted from an unrelated origin is rejected by the browser. | FILES-REQ-004 | Local, cloud |
| FILES-AC-005 | Unsigned requests to the stage's storage are refused. | FILES-REQ-005 | Cloud |
| FILES-AC-006 | With storage unreachable, server operations fail with `FILES.UNAVAILABLE`; a browser transfer interrupted mid-way fails with `FILES.TRANSFER_FAILED` and an `interrupted after n bytes` message. | FILES-REQ-006 | Local |

## 5. Portability note

The server contract is the basic object-storage operation set (DEC-0011). Tickets are opaque. A provider without signed URLs could route transfers through a framework-owned upload service instead, changing only this component's adapter and the browser helper. A provider without header-bound signed URLs requires a FILES contract revision.
