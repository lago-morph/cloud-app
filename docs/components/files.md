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

File names are opaque. They MUST be non-empty, well-formed Unicode text, at most PAR-230 bytes in UTF-8; anything else is rejected with `FILES.INVALID_NAME`. Names MUST NOT be interpreted as filesystem paths.

#### FILES-REQ-003 — Browser transfers
Origin: owner · Derives from: SYS-REQ-008, SYS-REQ-014

The browser MUST be able to upload and download files using tickets created by app server code, with no limit imposed by the framework or by compute request-size limits. Each ticket:
- permits exactly one operation on exactly one name;
- expires after PAR-233;
- for uploads, requires the content type the ticket names.

Files up to the storage platform's single-upload maximum (PAR-234) are supported.

#### FILES-REQ-004 — Hidden mechanism
Origin: owner · Derives from: SYS-REQ-005, SYS-REQ-008

App code MUST NOT see storage services, signing, credentials, or cross-origin configuration. Any cross-origin access storage needs for transfers MUST be configured by the framework and limited to the stage's public origin (DEC-0058).

#### FILES-REQ-005 — Private storage
Origin: provenance-unclear · Derives from: SYS-REQ-008

Stored files MUST NOT be publicly readable or writable except through valid tickets.

#### FILES-REQ-006 — Failures
Origin: owner-approved · Derives from: SYS-REQ-010

Unreachable storage MUST surface as `FILES.UNAVAILABLE`. The browser helpers MUST throw `ApiError` with `FILES.TRANSFER_FAILED`, or `FILES.TICKET_EXPIRED` when the ticket has expired.

## 2. Design

**Tickets** carry what the browser needs to perform one HTTP request directly against storage:
- an upload ticket holds a URL, the HTTP method, the required headers, and an expiry time;
- a download ticket holds a URL and an expiry time.

`uploadFile` sends one `PUT` with progress reporting. `downloadUrl` returns the URL, which works in `<img src>`, links, and `fetch`. One `PUT` covers files up to PAR-234; multipart uploads are not used (DEC-0062). An app that cares about upload size or type can check `head` after the upload.

**Cross-origin configuration.** The bucket's CORS policy (the rules a browser checks before cross-origin requests) is set by provisioning. It allows `PUT` and `GET` from the stage's public origin only, with the `Content-Type` request header. App code and app configuration never touch it.

### Local
Server operations use the local R2 emulation through its Worker binding. Tickets point to a same-origin framework route, `/api/__framework/files/*`, which checks an HMAC-signed ticket and streams the body to or from local storage. There is no cross-origin traffic and no use of Wrangler's experimental local S3 endpoint.

### Cloudflare
Server operations use the R2 Worker binding. Tickets are SigV4-signed URLs for R2's S3-compatible endpoint, created with aws4fetch (PAR-105), because the binding cannot sign URLs. The signing credentials are an R2 API token scoped to the stage's bucket. Provisioning creates it and stores it as a framework-internal Worker secret.

### AWS
Server operations and tickets use S3 with the Lambda's role credentials, including the session token, through aws4fetch. A ticket's lifetime is capped so it does not outlive those credentials. Lambdas access S3 directly, outside any VPC.

## 3. Uses

HTTP (local transfer route; app routes that hand out tickets), CFG (bucket identifiers and public origin), SEC (R2 signing credentials), LOG.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| FILES-AC-001 | Binary round trip with byte-exact content and metadata; overwrite, missing `get`/`head`, repeated delete; list across several pages with exact names. | FILES-REQ-001 | Local, cloud |
| FILES-AC-002 | Names with spaces, `%`, `/`, `..`, and non-ASCII characters round-trip unchanged; empty and oversized names are rejected. | FILES-REQ-002 | Local, cloud |
| FILES-AC-003 | In a real browser on each target, a 20 MB file uploads through `uploadFile` and downloads through `downloadUrl` byte-exact. A ticket for one name cannot write another. An upload with a different content type is rejected. An expired ticket fails with `FILES.TICKET_EXPIRED`. | FILES-REQ-003 | Local, cloud |
| FILES-AC-004 | Contract and type inspection finds no storage-service names or credentials in app-facing types. A transfer attempted from an unrelated origin is rejected by the browser. | FILES-REQ-004 | Local, cloud |
| FILES-AC-005 | Unsigned requests to the stage's storage are refused. | FILES-REQ-005 | Cloud |
| FILES-AC-006 | With storage unreachable, server operations fail with `FILES.UNAVAILABLE`; a browser transfer interrupted mid-way fails with `FILES.TRANSFER_FAILED`. | FILES-REQ-006 | Local |

## 5. Portability note

The server contract is the basic object-storage operation set (DEC-0011). Tickets are opaque. A provider without signed URLs could route transfers through a framework-owned upload service instead, changing only this component's adapter and the browser helper.
