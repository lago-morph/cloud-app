# Root cause: phase-B exit check — template "Download" popup showed an empty URL and body

Author: diagnosing subagent diag-b4 (did not write the code involved; diagnosis only, no code or test changed). Needs independent review (prompt §8 step 2).

## Symptom
In the phase-B exit check (`validation/local/phase-B/10-exercise-pages.log` (archived: branch `archive/implement-local-cloudflare`, see ARCHIVE-INDEX.md), line 9), after uploading `b-run.txt` (`text/plain`, 33 bytes) through the template's Files page, clicking its "Download" button produced:

```
{"step":"files-download-popup","popupPath":"","matches":false,"bodyLength":0}
```

The next step, fetching a fresh download ticket and its URL from the page with `fetch`, returned the file unchanged (`ticketStatus 200, status 200, text/plain, matches true`). The first attempt (`10a-exercise-pages-first-attempt.log`) had ended with `{"step":"error","message":"Invalid URL"}` at the same step.

## Evidence
Reproduced on `origin/claude/implement-local-cloudflare` (branch `claude/implement-local-cloudflare-diag-b4`), framework built, `npm --workspace apps/template run dev` from the repo root (it served on `http://localhost:38289/`), Playwright Chromium with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (no `playwright install`). The probe scripts were scratch files (`repro.mjs`, `minimal.mjs`); they are not committed. Ticket tokens are shown as `<ticket>`.

E1. Code paths.
- `apps/template/src/client/pages/files.ts:15-17`: `download()` POSTs `/files/download-ticket`, then `window.open(downloadUrl(ticket), "_blank", "noopener")`.
- `packages/framework/src/files/client.ts:57-60`: `downloadUrl` returns the ticket's URL unchanged.
- `packages/framework/src/files/local/route.ts:15,17,49`: every response carries `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`; `Content-Disposition: attachment` is added unless the content type is a raster image (`image/png`, `jpeg`, `gif`, `webp`, `avif`, `bmp`).
- Check script `validation/local/phase-B/exercise/exercise-pages.mjs:74-90` (archived): it waits for a context `page` event, then `popup.waitForURL(/\/api\//)` (errors swallowed), reads `popup.textContent("body")` and `popup.url()`, and compares the body with the upload. It does not listen for a `download` event. In 10a it ran `new URL(popup.url())` unconditionally, which throws `Invalid URL` on `""`.

E2. Response headers of the local transfer route for a GET with a download ticket (curl after mock-login):
```
text/plain file:                       image/png file (control):
HTTP/1.1 200 OK                        HTTP/1.1 200 OK
content-length: 18                     content-length: 70
content-type: text/plain               content-type: image/png
cache-control: no-store                cache-control: no-store
content-disposition: attachment        content-security-policy: sandbox
content-security-policy: sandbox       x-content-type-options: nosniff
x-content-type-options: nosniff
```
Body for text/plain: `diag text content` (the uploaded bytes).

E3. Clicking the template's real "Download" button in Chromium, with Playwright `page`, `framenavigated`, `download` and `response` listeners (output verbatim except tokens):
```
{"step":"uploaded","name":"diag.txt","mimeType":"text/plain","base64":"ZGlhZyB0ZXh0IGNvbnRlbnQK"}
{"step":"context-page-event","urlAtEvent":""}
{"step":"popup-framenavigated","url":""}
{"step":"download-event","tag":"opener","suggestedFilename":"<ticket>","urlPath":"/api/__framework/files/<ticket>","body":"ZGlhZyB0ZXh0IGNvbnRlbnQK"}
{"step":"popup-state","name":"diag.txt","popupUrl":"","isClosed":false,"bodyText":"","imgSize":null,"downloadEvent":"no download: page.waitForEvent: Timeout 8000ms exceeded while waiting for event \"download\""}
{"step":"uploaded","name":"diag.png","mimeType":"image/png","base64":"iVBORw0KGgo…"}
{"step":"context-page-event","urlAtEvent":"http://localhost:38289/api/__framework/files/<ticket>"}
{"step":"popup-state","name":"diag.png","popupUrl":"/api/__framework/files/<ticket>","isClosed":false,"bodyText":"","imgSize":[1,1],"downloadEvent":"no download: …Timeout 8000ms…"}
```
For text/plain, Chromium made a **download** with exactly the uploaded bytes (base64 equal). Playwright reported that download on the opener page, not the popup. The popup stayed on the initial empty document (`url ""`, empty body). For the raster control, the popup navigated to the ticket URL and rendered the 1x1 image, with no download.

E4. A minimal reproduction without the framework: a plain `node:http` server and a page that calls `window.open(url, "_blank", "noopener")`, answering `text/plain` with or without `Content-Disposition: attachment`:
```
{"event":"download on opener","path":"/file?att=1","suggested":"file.txt"}
{"case":"attachment","popupUrl":"","body":""}
{"case":"inline","popupUrl":"http://127.0.0.1:34489/file","body":"hello minimal\n"}
```
This matches E3 exactly, so the behaviour belongs to Chromium/Playwright and the response header, not to the framework or the template.

E5. Specification. `docs/components/files.md`, local section (line 74): the local route's "responses always carry `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`, plus `Content-Disposition: attachment` for content types other than raster images, so uploaded HTML or SVG never runs as the app's origin". Line 56: "`downloadUrl` returns the URL, which works in `<img src>` and links." FILES-AC-003 requires a byte-exact download through `downloadUrl`. `docs/components/skill.md` §2 (Files example): "file content reaches the browser only through `downloadUrl`". Nothing requires the content to be shown in a page.

## Cause → symptom chain
1. The uploaded file was `text/plain`, so the local route answers its download with `Content-Disposition: attachment`. Evidence: E1 (`route.ts:49`), E2 (header present for text/plain, absent for image/png). This is the specified behaviour (E5).
2. The template opens the ticket URL in a new browsing context with `window.open(..., "_blank", "noopener")`. Evidence: E1 (`files.ts:17`).
3. Chromium treats a navigation answered with `Content-Disposition: attachment` as a download: the new context never commits the navigation and stays on its initial empty document, whose URL Playwright reports as `""`. Evidence: E3 (`framenavigated` url `""`, popup `url ""`, body `""`, while a download with the uploaded bytes occurs); E4 shows the same thing without the framework, and the inline case navigates and shows the body.
4. Playwright raises that download as a `download` event (here on the opener page), not as content of the popup. Evidence: E3 and E4 (`download` on the opener, none on the popup).
5. The check script only read the popup's URL and `body` text and never listened for `download`, so it recorded `popupPath ""`, `bodyLength 0`, `matches false` (10). In 10a, `new URL("")` threw `Invalid URL`. Evidence: E1 (script lines 74-90) and the logged lines, which match E3's popup state.
6. The fetch-based step read the same route's response body directly, where `Content-Disposition` has no effect, so it matched. Evidence: 10 line 10; E2 body.

## Alternatives ruled out
- **The template sends a bad URL or none.** Ruled out: the download event's URL is `/api/__framework/files/<ticket>` and its bytes equal the upload (E3), and the PNG case opens the same kind of URL (E3).
- **`downloadUrl` changes or loses the URL.** Ruled out: it returns `data.url` unchanged (E1), and the request reached the route and returned 200 (E3; dev log `GET /api/__framework/files/<ticket> 200 OK`).
- **The local transfer route returns an empty or wrong body to browser navigations.** Ruled out: the bytes Chromium saved equal the upload (E3, base64 `ZGlhZyB0ZXh0IGNvbnRlbnQK` for both).
- **`dev` (Vite proxy or Wrangler) drops or alters the response.** Ruled out: curl through the same dev origin got the full body and headers (E2), and the browser download was byte-exact (E3).
- **`noopener` hides the popup's URL from Playwright.** Ruled out as the cause: with `noopener`, the inline text and the PNG cases both report the navigated URL and content (E3, E4). Only the attachment case stays at `""`.
- **Timing (the wait was too short).** Ruled out: the download finished during the wait, and the popup stayed at `""` 1.5 s after the 8 s download wait ended (E3). An attachment navigation never commits, however long the wait.

## Conclusion
**Not a defect** in `apps/template`, the framework's `downloadUrl`, the FILES local transfer route or `dev`. The download worked and delivered the uploaded file byte for byte, as a browser download, which is what files.md specifies for a non-raster content type. The empty popup is an artefact of the check script, which looked for the file in the popup page instead of in Playwright's `download` event.

Side observation, not a spec violation: the route sends `Content-Disposition: attachment` with no `filename`, so Chromium names the saved file after the last URL segment, i.e. the ticket token (E3 `suggestedFilename`), not `diag.txt`. files.md asks only for `attachment`. Whether a `filename` should be specified is a design question for the owner, not part of this finding. A popup tab that stays blank is also normal browser behaviour for attachment downloads; if the template's UX should avoid it, that is a separate, optional change (for example a link with the `download` attribute), not a fix for this observation.

## Proposed fix
No product or test change. When the exit check is re-run, its runner script should observe the button-driven download correctly. Arm `context`/`page` `waitForEvent("download")` (Chromium may attribute it to the opener or to the popup, so listen on the context's pages) before clicking "Download", then compare `download.path()` contents with the uploaded bytes, and do not parse `popup.url()` when it is `""`. Optionally add a raster-image case that does check the popup's URL and content. The script is a runner input under `validation/`, so this is the runner's change, not a framework one.

## Verification
- Re-run the phase-B page exercise with the corrected script against `npm --workspace apps/template run dev`. Expected: a `download` event for the "Download" click whose saved file equals the uploaded `b-run.txt` bytes (as in E3), and the fetch step still matching.
- No test change is needed for this finding. Note for the evaluator: at this commit, FILES-AC-003 is referenced only in `packages/framework/src/files/client.unit.test.ts`. No real-browser byte-exact download test appears in 05b (whose tests are FILES-AC-004, FILES-AC-006 and HTTP-AC-006) or in `06-per-test-statuses.txt`. If that real-browser test is written, it must read the download through Playwright's `download` event (or fetch), for the reason given above.

## Review

Reviewer: independent root-cause reviewer rc-b4-review (did not diagnose this or write the code; no code or test changed). Branch `claude/implement-local-cloudflare-rc-b4-review` from `origin/claude/implement-local-cloudflare`.

**Verdict: ACCEPTED.**

Checks against the source:
- E1 is accurate. `route.ts:15,17,48-49` adds `Content-Disposition: attachment` for every non-raster type, alongside `nosniff` and `CSP: sandbox`. `files.ts:15-18` opens `downloadUrl(ticket)` with `window.open(..., "_blank", "noopener")`. `client.ts` `downloadUrl` returns `data.url` unchanged. `exercise-pages.mjs` waits only for a context `page` event and reads `popup.url()` and `body`, with no `download` listener. The 10 and 10a log lines are as quoted, and SUMMARY.md confirms that 10a's `Invalid URL` came from the script parsing the popup URL.
- E5 is accurate. files.md "Local" requires `attachment` for non-raster types, and nothing requires the content to be shown in a page.

Independent reproduction (Chromium from `/opt/pw-browsers`, my own scratch probe, `npm --workspace apps/template run dev` from the repo root on `http://localhost:39857/`, stopped afterwards). I clicked the template's real "Download" button, with `download` listeners on the opener page and on every popup:
```
{"case":"text/plain","popupUrl":"","popupBodyLen":0,"downloads":[{"tag":"opener","failure":null,"equal":true,"len":27,"expectedLen":27}]}
{"case":"text/html","popupUrl":"","popupBodyLen":0,"downloads":[{"tag":"opener","failure":null,"equal":true,"len":47,"expectedLen":47}]}
{"case":"image/png","popupUrl":"http://localhost:39857/api/__framework/files/<ticket>","downloads":[],"img":[1,1]}
```
The dev log shows each of the 3 uploads and 3 downloads answered 200.

Link-by-link:
1. Attachment disposition for text/plain is confirmed: E2 in the record matches the code.
2. The page opens the ticket URL in a new context: confirmed by the code.
3. The popup stays on the empty initial document with URL `""`: reproduced for text/plain and also for text/html. The raster control navigates and renders the image, which isolates the disposition header as the deciding factor.
4. Playwright reports a `download` on the opener, with no failure and bytes equal to the upload: reproduced.
5. The script read only the popup, which explains `popupPath ""`, `bodyLength 0`, `matches false`, and `new URL("")` → `Invalid URL` in 10a: confirmed from the script source.
6. The fetch step matched because it read the body directly: consistent.

Alternatives:
- "The user gets no file" (a real defect) is ruled out. `download.failure()` is null and the saved bytes equal the upload exactly, so the button delivers the file.
- A bad or missing URL, or `downloadUrl` altering it, is ruled out by the 200 responses and the byte-exact download.
- `noopener` or timing as the cause is ruled out by the PNG control, which opens with the same call and the same waits.
- A route or dev-proxy body problem is ruled out by the byte equality.

Fix assessment: the proposal (no product change; the runner observes the `download` event, listening on the context's pages) addresses the cause, the observation method, rather than the symptom. It weakens no test.

Notes, which do not affect the verdict:
- The saved file's suggested name is the ticket token, because there is no `filename=`. The blank tab left open is a UX point. Both are correctly left to the owner as design questions.
- The note that a real-browser FILES-AC-003 test must use the `download` event or `fetch` is sound.
