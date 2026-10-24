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

File names are opaque. They MUST be non-empty, well-formed Unicode text, at most PAR-230 bytes in UTF-8, MUST NOT be exactly `.` or `..` (DEC-0505), and MUST NOT contain U+0000–U+001F or U+007F; anything else is rejected with `FILES.INVALID_NAME` on every target, before any storage call. Names MUST NOT be interpreted as filesystem paths: a name that merely contains dots, or has `.` or `..` as a `/`-separated segment (`a/../b`, `./x`), is valid and is not resolved.

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

**Download names** (DEC-0313, DEC-0414). A download is saved under the file's whole name: storage's response carries `Content-Disposition: attachment; filename*=UTF-8''<name>` (RFC 6266 / RFC 8187; every byte outside `attr-char` percent-encoded, `/` included) for every content type, raster images included, on every target. Images still display through `<img src>`, which ignores the header. Nothing in the name is interpreted as a path; browsers replace unsafe characters when they save. One helper (`src/files/cloudflare/disposition.ts`) builds the value for every target. On Cloudflare and on AWS the download ticket signs it as storage's `response-content-disposition`.

**Shared runtime shape** (DEC-0160, DEC-0162, DEC-0164):
- One target-neutral service runs over the object store (the R2 Worker binding, locally and on Cloudflare), with a ticket issuer supplied by each target.
- Both kinds of ticket are plain JSON with `url` and `expiresAt` (milliseconds). An upload ticket also holds `method` (`PUT`) and `headers` (always `Content-Type`). The browser helpers read only these fields, so they behave the same on every target.
- A `list` cursor encodes the prefix and the last name returned. The next page asks the store for names after that name, and the service fills each page to its limit even when the store returns short pages. A `limit` is clamped to 1…PAR-232.
- Every store failure that is not already a `FrameworkError` becomes `FILES.UNAVAILABLE` and is logged once. `createUploadTicket` asks the store for the name's metadata first, so it also fails when storage is unreachable.

**Cross-origin configuration.** The bucket's CORS policy (the rules a browser checks before cross-origin requests) is set by provisioning. It allows `PUT` and `GET` from the stage's public origin only, with the `Content-Type` request header. App code and app configuration never touch it.

### Local
Server operations use the local R2 emulation through its Worker binding. Tickets point to a same-origin framework route, `/api/__framework/files/*`, which checks an HMAC-signed ticket and streams the body to or from local storage. Its responses always carry `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`, and a download carries the named `Content-Disposition: attachment` above, so uploaded HTML or SVG never runs as the app's origin. There is no cross-origin traffic and no use of Wrangler's experimental local S3 endpoint.

Implementation details (DEC-0161, DEC-0163):
- A local ticket's URL is the relative path `/api/__framework/files/<token>`. The token is base64url JSON of operation, name, content type (uploads) and expiry time, followed by `.` and its HMAC-SHA-256 signature. The signing key is the framework-internal local secret that `dev` generates into `.dev.vars` (SEC).
- The route accepts `PUT` with an upload ticket and `GET` with a download ticket. An upload must send exactly the ticket's `Content-Type`.
- A ticket that is malformed, tampered with, expired, used for the other operation, or used with a different content type gets an empty 403. A download of a file deleted after the ticket was issued gets an empty 404. These refusals are not logged, so ticket URLs never reach the log.
- The route sends no CORS headers, so other origins cannot use it.
- The route reads an upload body completely before storing it. R2's binding accepts only streams of known length, and a request body in the Node process of `createTestApp` is not one. This is local only, so the limit is the machine's memory, not a framework limit.
- The route, its tickets and the key's name live only in `src/files/local/`. Nothing else in FILES imports them, so cloud bundles can leave them out (CORE-REQ-006).

### Cloudflare
Server operations use the R2 Worker binding. Tickets are SigV4-signed URLs for R2's S3-compatible endpoint, created with aws4fetch (PAR-105), because the binding cannot sign URLs. The signing credentials are an R2 API token scoped to the stage's bucket. Provisioning creates it and stores it as a framework-internal Worker secret.

Implementation details (DEC-0098…DEC-0100, DEC-0327…DEC-0330, DEC-0430; code in `src/files/cloudflare/`, with the SigV4 signing, URL path and CORS preflight shared with AWS in `src/files/s3/`):
- **R2 keys carry an invisible U+0001 ending.** R2 does not list in code point order when one key is a proper prefix of another (the end of a key ranks like a byte between 0x31 and 0x61), and its `startAfter` does not follow its listing order. So the Cloudflare store (`cloudflareFilesStore`, `keys.ts`) stores each name as the R2 key `name + U+0001`, which no name can contain and which sorts below every byte a name can hold. No stored key is then a proper prefix of another, and R2 lists in code point order (FILES-REQ-001). A name of exactly PAR-230 bytes is stored without the ending, because R2's key limit is also 1,024 bytes; such a name can be a prefix of no valid name. `put`, `get`, `head`, `delete` and paging (`startAfter`) use the stored key; listed keys have the ending removed, so apps only ever see names. Tickets address the stored key (`…/<name>%01`); the download's `response-content-disposition` names the file without the ending. The shared service and the local target keep plain keys. Owners see the ending in the R2 dashboard and in `wrangler r2 object get <bucket>/<key>`: a lookup by the plain name finds nothing, and the key to use is the name followed by U+0001. S3 tools listing the bucket must use `encoding-type=url`, because U+0001 cannot appear in XML 1.0.
- A ticket URL is path-style, `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`, with each `/`-separated segment of the name RFC 3986-encoded. URL parsers resolve `.` and `..` segments even when percent-encoded, so a name with such a segment is sent with every `/` as `%2F` (storage decodes it back to the same key); a name that is only `.` or `..` is invalid on every target (FILES-REQ-002, DEC-0505), so it never reaches the issuer, which still refuses it (`FILES.INVALID_NAME`). Both rules test the name, not the stored key with its ending, so they behave as before the ending was added.
- Signing: aws4fetch, `service: "s3"`, `region: "auto"`, query signing with every passed header signed (`allHeaders`), and `X-Amz-Expires` = PAR-233 in seconds. An upload ticket signs `Content-Type` (`X-Amz-SignedHeaders=content-type;host`), so storage refuses another content type. A download ticket signs only `host`, plus the `response-content-disposition` query parameter, which names the file (see "Download names").
- Credentials: the Worker secrets `frameworkR2AccessKeyId` and `frameworkR2SecretAccessKey`, read for each ticket. Provisioning derives them from the token it creates: access key ID = token `id`, secret access key = lowercase hex SHA-256 of token `value` (`s3CredentialsFromToken`).
- The bucket's CORS policy body and API path come from `bucketCorsPolicy(publicOrigin)` / `bucketCorsPath` (one rule, max age 60 s; the origin must be exactly one origin). Deploy's health step sends one preflight with `checkStorageCors`: `OPTIONS` to the bucket from the public origin asking for `PUT` with `content-type`; it passes only on a 2xx whose `Access-Control-Allow-Origin` is that origin.

Note: R2 sends no CORS headers on its 403 responses (expired or mismatched ticket), so the browser cannot read storage's status there; on Cloudflare such a transfer fails with status null and the `no response: network or cross-origin blocked` message. This conflicts with FILES-AC-003's expired-ticket clause and is an open owner item: see DEC-0101.

### AWS
Server operations and tickets use S3 with the Lambda's role credentials, including the session token, through aws4fetch. Tickets last PAR-233, on the assumption that role sessions outlast it; a ticket whose credentials expire early fails in the browser with `FILES.TRANSFER_FAILED` and storage's status. Lambdas access S3 directly, outside any VPC. File content reaches the browser only through `downloadUrl`, never as an API route's response body: Lambda buffers responses and refuses those above its response payload limit, so a route returning a `files.get` stream fails on AWS for large files.

Implementation details (DEC-0461…DEC-0467; code in `src/files/aws/`, sharing `src/files/s3/` with Cloudflare; pre-checked against an in-process S3 fake only, not yet verified on AWS):
- **Keys are the names.** S3 general purpose buckets list in UTF-8 byte order, a proper prefix first, and `start-after` follows that order, so the AWS store adds no U+0001 ending (DEC-0430 is Cloudflare only).
- **Store** (`createS3FilesStore`): the shared service runs over S3's REST API at `https://<bucket>.s3.<region>.amazonaws.com/<key>` (virtual-hosted; the bucket name has no dots). Every request is header-signed with aws4fetch, carries the session token and `x-amz-expected-bucket-owner`, and a `PUT` signs its payload's SHA-256. `list` is one `ListObjectsV2` with `encoding-type=url` and one `HEAD` per listed object, because S3 listings carry no content type. `get`/`head` return null on 404, and `delete` of an absent key succeeds. Any other answer, and a network failure, becomes `FILES.UNAVAILABLE` naming the status and S3 error code, never the body. The role needs `s3:ListBucket` on the bucket; without it S3 answers 403 for an absent key.
- **Names.** Key paths follow DEC-0328 (`src/files/s3/path.ts`): a name with a `.`/`..` segment is sent with every `/` as `%2F`. A name that is only `.` or `..` cannot be put in a URL; FILES-REQ-002 makes such names invalid on every target (DEC-0505), so there is no target difference.
- **Tickets** (`createAwsTicketIssuer`): query-signed (`X-Amz-Expires` = PAR-233 in seconds), with `X-Amz-Security-Token` signed in the URL. An upload signs `Content-Type`; a download signs `host` and `response-content-disposition` (see "Download names").
- **Credentials** (`lambdaSessionCredentials`): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN` from the Lambda environment, read for each request and ticket.
- **CORS**: `bucketCorsArgs(publicOrigin)` is the stage bucket's `cors` value for `sst.aws.Bucket`, with every field set because SST's defaults allow every origin. `checkStorageCors` sends deploy's one preflight to the bucket's virtual-hosted URL, as on Cloudflare.

## 3. Uses

HTTP (local transfer route; app routes that hand out tickets), CFG (bucket identifiers and public origin), SEC (R2 signing credentials), LOG.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| FILES-AC-001 | Binary round trip with byte-exact content and metadata; overwrite, missing `get`/`head`, repeated delete; list across several pages with exact names. | FILES-REQ-001 | Local, cloud |
| FILES-AC-002 | Names with spaces, `%`, `/`, `..` segments, and non-ASCII characters round-trip unchanged; empty and oversized names, the names `.` and `..`, and names containing CR, LF, or NUL, are rejected with `FILES.INVALID_NAME`. | FILES-REQ-002 | Local, cloud |
| FILES-AC-003 | In a real browser on each target, a 20 MB file uploads through `uploadFile` and downloads through `downloadUrl` byte-exact. A ticket for one name cannot write another. An upload with a different content type is rejected, and `uploadFile` rejects a Blob whose non-empty `type` differs from the ticket's before sending, with `FILES.TRANSFER_FAILED`, status null, and a `content type does not match ticket` message. An expired ticket fails with `FILES.TRANSFER_FAILED`, storage's status, and a `rejected by storage (HTTP n)` message without storage's error body. | FILES-REQ-003, FILES-REQ-006 | Local, cloud |
| FILES-AC-004 | Contract and type inspection finds no storage-service names or credentials in app-facing types. A transfer attempted from an unrelated origin is rejected by the browser. | FILES-REQ-004 | Local, cloud |
| FILES-AC-005 | Unsigned requests to the stage's storage are refused. | FILES-REQ-005 | Cloud |
| FILES-AC-006 | With storage unreachable, server operations fail with `FILES.UNAVAILABLE`; a browser transfer interrupted mid-way fails with `FILES.TRANSFER_FAILED` and an `interrupted after n bytes` message. | FILES-REQ-006 | Local |

## 5. Portability note

The server contract is the basic object-storage operation set (DEC-0011). Tickets are opaque. A provider without signed URLs could route transfers through a framework-owned upload service instead, changing only this component's adapter and the browser helper. A provider without header-bound signed URLs requires a FILES contract revision.
