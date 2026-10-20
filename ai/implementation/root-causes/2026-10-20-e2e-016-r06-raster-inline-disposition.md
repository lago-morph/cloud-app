# Root cause: E2E-016 R-06, raster images download `inline`, and local and Cloudflare disagree

Author: diagnosing subagent (prompt §8 step 1). I wrote none of the FILES code, tests or decisions involved. This is a diagnosis only: no code, test or document was changed. It needs an independent review (§8 step 2) before anyone fixes it.

Branch: `claude/implement-local-cloudflare-diag-f04`, reset to `claude/implement-local-cloudflare` `b59ec88`. No Cloudflare calls. The worktree has no `node_modules`. My experiments ran in-process with Node 22 and the Playwright Chromium in `/opt/pw-browsers` (`playwright-core` from `/opt/node-tools`). Their scripts are in my scratchpad, are not committed, and are quoted below.

## Symptom

`validation/reviews/E2E-016.md`, check 3, finding R-06 (blocking): choosing `inline` instead of `attachment` for raster images is behaviour that no FILES requirement asks for, and it differs by target. A local download of a PNG/JPEG/GIF/WebP/AVIF/BMP gets `Content-Disposition: inline; filename*=…`. On Cloudflare, the same file's download ticket signs `attachment; filename*=…`.

## Short answer

All of the reviewer's claims hold. There is also a third gap the review did not name: `targets/cloudflare/tickets.ts:30` drops the content type too. The raster exception goes back further than DEC-0313. The owner-reviewed files.md wording "`attachment` for content types other than raster images" (`3a10800`) was a **security** rule for the *same-origin* local route: uploaded HTML or SVG must not run as the app's origin. Images were simply left without a disposition. DEC-0313 turned that omission into an explicit `inline`. DEC-0329 then left the Cloudflare half unwired. No REQ or AC needs inline images. `<img src>` ignores `Content-Disposition` (experiment E9), and "displays" in DEMO-AC-003, E2E-009 and DEMO-REQ-003 is checked through `<img>`. Making Cloudflare match local (option b) would **break E2E-009 on Cloudflare**. For a cross-origin URL, Chromium ignores a link's `download` attribute, so an `inline` image navigates instead of downloading, and the test's `download` event never fires (E9). **Fix: option (a). Serve `attachment; filename*=…` for every content type on every target, and supersede the raster exception of DEC-0313 and DEC-0329. Owner: D-02. Every file involved is already in D-02's Owns line (`plan.md:308`).**

## Evidence

E1. **Local passes the stored content type.** `packages/framework/src/files/local/route.ts:40-47`: `const file = await c.var.files.get(grant.name)` … `"Content-Disposition": downloadDisposition(grant.name, file.contentType)` (line 46).

E2. **The service never passes one.** `packages/framework/src/files/service.ts:41-44`: `interface TicketIssuer { upload(name, contentType) …; download(name: string): Promise<unknown>; }` (line 43). `service.ts:147-150`: `createDownloadTicket` calls `store.head(name)` only for existence, then `return (await options.tickets.download(name)) as DownloadTicket;` (line 150).

E3. **The Cloudflare target wrapper also drops it** (not in the review). `packages/framework/src/targets/cloudflare/tickets.ts:28-31`: `download: async (name) => issuer().download(name)` (line 30). This is the issuer `stage.ts:134` hands to `createFilesService` (`tickets: options.tickets(env, …)`). Even if `service.ts` passed a content type, this wrapper would discard it. Option (b) would therefore need edits in B-11's `service.ts`, in the target wrapper (owned by B-16/D-01, `plan.md:186,301`) and in D-02's issuer.

E4. **The Cloudflare issuer defaults to attachment.** `packages/framework/src/files/cloudflare/tickets.ts:51-58` (`download(name, contentType?)`, "without it the download is an attachment") and line 83: `downloadDisposition(name, contentType ?? "")`. `disposition.ts:26-31`: `isRasterImage("")` is false, so the value is `attachment; filename*=…`.

E5. **In-process reproduction of the two values** (Node 22 `--experimental-strip-types`, `disposition.ts` copied unchanged, the two call shapes of E1 and E4):
```
local route  (route.ts:46, image/png): inline; filename*=UTF-8''p.png
cloudflare   (tickets.ts:83, contentType undefined -> ""): attachment; filename*=UTF-8''p.png
```

E6. **What the requirements and decisions say.** FILES-REQ-001…006 (`docs/components/files.md:9-48`) do not mention download names, disposition or inline display. FILES-REQ-003 asks only that the browser "upload and download files using tickets". `files.d.ts` and `client.d.ts` contain no disposition (`grep -rni "inline\|disposition" docs/contracts` finds nothing). DEC-0313 (`decision-log.md:2433-2437`, ai-proposed, "owner review open; not yet implemented", a stale status since `disposition.ts:30` exists): "files.md does not say what name a download gets … `attachment; filename*=…` for every content type except raster images, which stay `inline; filename*=…` as they are now." DEC-0329 (`decision-log.md:2588-2592`, ai-proposed, owner review open): "`TicketIssuer.download(name)` does not pass it, so the Cloudflare issuer takes an optional second argument and defaults to `attachment`. `<img src>` ignores `Content-Disposition`, so images still display. … Until then, Cloudflare names raster images `attachment`." `files.md:65` documents the split. `files.md:76,82` (Local) define the raster list.

E7. **Origin of the raster exception.** `git log -S raster -- docs/components/files.md`: it first appears in `3a10800` ("docs: apply review panel recommendations (editor pass)", `docs/README.md` status: "Reviewed by owner"). That commit's Local text: "plus `Content-Disposition: attachment` for content types other than raster images, so uploaded HTML or SVG never runs as the app's origin". B-11's original route (`git show d4bf78f~1:…/route.ts:49`): `if (!RASTER_IMAGES.has(mediaType(file.contentType))) headers["Content-Disposition"] = "attachment";`. Images got no disposition header at all. Root cause `2026-10-19-template-download-popup.md` (E2, E5) confirms: "content-disposition: attachment" for text/plain, and absent for image/png. So the purpose was to force `attachment` on the same-origin route for anything that could run as script. Displaying images inline was never a stated goal. It was the browser default for a response with no header. DEC-0313's "inline … as they are now" made that default explicit.

E8. **What depends on displaying images.** DEMO-REQ-003 (`docs/demo/demo-spec.md:28`): "Photos display in the post." DEMO-AC-003 (`:78`): "A 20 MB JPEG uploads, displays, and is byte-identical when downloaded." E2E-009 (`e2e-scenarios.md:100-102`): "upload … view them, and download them. Pass: the downloads are byte-identical." The tests check display through `<img>`: `tests/compliance/e2e/demo-pages.spec.ts:227,248-255` (`document.images` `naturalWidth > 0`) and `E2E-009-large-photos.spec.ts:141` (`preview` image `naturalWidth`). They check the download through a link and Playwright's `download` event: `E2E-009-large-photos.spec.ts:145` `Promise.all([page.waitForEvent("download"), item.getByTestId("download").click()])`. The link is `<a download>`, `apps/reference/src/client/pages/files.ts:32-34`. The photos are BMP (`E2E-009-large-photos.spec.ts:12`, "uncompressed 24-bit BMP images (a raster type …)"), so `image/bmp`, a raster type. The demo shows photos with `<img src=downloadUrl(…)>` and a `target=_blank` link (`apps/demo/src/client/pages/post-view.ts:14-22`). No test reads `Content-Disposition` outside FILES' own unit tests (`grep -rni disposition tests apps` finds none).

E9. **Experiment: disposition × origin, with an `<img>` and a `<a download>` link** (one run; two `node:http` servers on 127.0.0.1, so the page origin and the "storage" origin differ; a 2×1 BMP; Chromium 1248 through `playwright-core`; script `scratchpad/dispo/exp.mjs`):
```
same-origin inline (local today): img naturalWidth=2; link click -> download event (suggested p.bmp)
same-origin attachment (local under option a): img naturalWidth=2; link click -> download event (suggested p.bmp)
cross-origin inline (Cloudflare under option b): img naturalWidth=2; link click -> NO download event; page now at localhost/p.bmp
cross-origin attachment (Cloudflare today / option a): img naturalWidth=2; link click -> download event (suggested p.bmp)
```
Results: (i) `<img>` displays in all four cases, so display never depends on `inline`. (ii) On the same origin (the local route), the `download` attribute downloads either way. (iii) Across origins (an R2 ticket URL is `https://<account>.r2.cloudflarestorage.com/…`, a different origin from the Worker, `files.md:90`), Chromium ignores `download`. With `inline` the click navigates to the image and no download happens. E2E-009 on Cloudflare would then time out at line 145. Option (b) breaks a scenario that currently works by design. Option (a) keeps it working.

E10. **The tests that pin the current behaviour** (all D-02-owned, `plan.md:308`):
- `packages/framework/src/files/local/route.unit.test.ts:88-94` (a valid download of `image/png` expects `inline; filename*=UTF-8''p.png`) and `:111-116` (`it.each` jpeg/gif/webp/avif/bmp "served inline").
- `packages/framework/src/files/cloudflare/disposition.unit.test.ts:17-21` (`it.each` raster types "is inline").
- `packages/framework/src/files/cloudflare/tickets.unit.test.ts:105-110` ("a raster image is named inline; without a known content type the download is an attachment").

## Chain (cause → symptom), with evidence for each link

1. The owner-reviewed design forced `attachment` only for non-raster types on the same-origin local route. That was a safety rule, and images were left at the browser default (E7).
2. DEC-0313 gave every download a file name, and it turned "no header for images" into an explicit `inline; filename*=…`. It recorded that as "as they are now", with no requirement behind it (E6, E7).
3. D-02 implemented `inline` in the shared helper and the local route (E1, E4). The Cloudflare path needs the content type, which `TicketIssuer.download(name)` does not carry. DEC-0329 left the service change undone (E6), and the target wrapper drops the argument as well (E3).
4. So locally a raster image is `inline` and on Cloudflare it is `attachment` (E5), which is behaviour beyond FILES-REQ-001…006 that also differs by target. That is E2E-016 check 3's finding (symptom).

## Alternatives ruled out

- **Some REQ or AC needs inline images.** Ruled out. No FILES REQ, contract or AC mentions disposition (E6). "Displays" (DEMO-REQ-003, DEMO-AC-003, E2E-009 "view") is shown through `<img>`, which works with either value (E8, E9-i).
- **Option (b): make Cloudflare match local.** Rejected for three reasons. It needs three owners' files (E3). It keeps behaviour no requirement asks for. And it breaks E2E-009's cross-origin download on Cloudflare (E9-iii). It would also make R-06 depend on owner acceptance of DEC-0313/0329, which are still "owner review open".
- **Leave it as a recorded deviation.** Not acceptable. The divergence is a target difference in observable behaviour that no criterion states. COMPL-REQ-001 allows "no per-target expectations except those a criterion states".
- **Drop the disposition entirely (back to pre-DEC-0313).** Not minimal. Saving a file under the ticket token was the defect DEC-0313 fixed (`2026-10-19-template-download-popup.md:78`), and the local same-origin route still needs `attachment` for HTML and SVG (E7).

## Proposed fix (minimal, red-green): option (a), owner D-02

1. **Red test first** (in-process, no cloud), in `packages/framework/src/files/local/route.unit.test.ts` (D-02 owns it for DEC-0313), tagged as the file's other DEC-0313 tests are:
   "a raster image downloads with the same Content-Disposition on local and Cloudflare". Store `p.png` as `image/png` in the route test's store, then:
   - **local:** GET it through the local transfer route with a valid download ticket and read the `Content-Disposition` response header;
   - **Cloudflare:** build `createFilesService({ store: <same store>, tickets: workerTicketIssuer({ FRAMEWORK_R2_ACCOUNT_ID: "acct", FRAMEWORK_FILES_BUCKET: "bucket" }, async () => "fixed") })`, which is the path `stage.ts:134` wires on Cloudflare. Call `createDownloadTicket("p.png")`, and read `response-content-disposition` from the ticket URL;
   - assert that the two values are equal and both are `attachment; filename*=UTF-8''p.png`.

   Today it fails on equality: local `inline; …` and Cloudflare `attachment; …` (E5). After the fix it passes. If D-02 prefers not to import `targets/cloudflare/tickets.ts` in a FILES test, `createCloudflareTicketIssuer` with fixed credentials gives the same Cloudflare value. The service call must still be used, because the service path is where the divergence arises.
2. **Fix.**
   - `files/cloudflare/disposition.ts`: `downloadDisposition(name)` always returns `attachment; filename*=…`. Remove `RASTER_IMAGES` and `isRasterImage`. Update the header comment.
   - `files/local/route.ts:46`: `downloadDisposition(grant.name)`. Update the comment at lines 4-6.
   - `files/cloudflare/tickets.ts`: remove the optional `contentType` from `CloudflareTicketIssuer.download` (lines 51-58, 80-83).
   - No change to `service.ts`, `TicketIssuer` or `targets/cloudflare/tickets.ts`.
3. **Update the tests that pin inline** (E10). They expect `attachment` for raster types now. Keep the non-raster and encoding cases.
4. **Docs and decisions.** `files.md:65` ("Download names": `attachment; filename*=…` for every content type; drop the inline/DEC-0329 clause). `files.md:76` (Local: "a download carries the named `Content-Disposition: attachment` above"). `files.md:82` (drop the "Raster images means …" sentence). Add an ai-proposed decision draft (D-02) that supersedes the raster-`inline` part of DEC-0313 and the content-type part of DEC-0329. Both are ai-proposed, so an implementer may change them with a decision-log entry (CONVENTIONS §4). Reason: no requirement asks for it, it differs by target, and E9 shows it would break E2E-009 on Cloudflare. Mark DEC-0313's stale "not yet implemented" status. `plan.md:292` still describes `inline; …` for raster images; a planning subagent should update it, since D-02 does not own the plan.
5. Optional, not required for R-06: R-03 (moving the helper out of `cloudflare/`) can ride along only if D-02 is given a neutral FILES path. I do not recommend widening this fix for it.

## Verification

Per plan §1 Test economy rule 1 (implementer/fixer):
- Red, then green: the new parity test above.
- `vitest related` on the changed files: `disposition.unit.test.ts`, `tickets.unit.test.ts`, `route.unit.test.ts`, `sign.unit.test.ts` (its disposition query vector is independent of the helper and must stay green), `service.unit.test.ts`. Then `npm run typecheck` and `npm run lint`, and FILES' integration suite (local).
- Compliance criteria by ID, local: FILES-AC-003 (download byte-exact through `downloadUrl`), E2E-009 (view in `<img>`, download through `<a download>`; same-origin, so it downloads either way, E9-ii), DEMO-AC-003 (display via `<img>`, E9-i).
- Cloudflare: the service path's behaviour is unchanged. It was already `attachment` (E4, E5), so no extra cloud run is needed. The planned D-RUN check that R2 honours the signed `response-content-disposition` (`plan.md:348`, DEC-0329) still applies, with the value `attachment; …`. FILES-AC-003, E2E-009 and DEMO-AC-003 cloud runs stay as already planned (currently blocked on D1, DEC-0317).
- Affected criteria and scenarios: E2E-016 (review part, re-review of check 3); FILES-AC-003, E2E-009 and DEMO-AC-003 (re-run local). Changing FILES adapter code invalidates milestone records under COMPL-REQ-006 ("after a change to … adapter code"). The fixer or the integrator should check whether any milestone record exists yet for an item that exercises FILES downloads, and add a `validation/invalidations.md` line if one does.

## Evidence files

- Code at `b59ec88`: `packages/framework/src/files/{service.ts:41-44,147-150, local/route.ts:1-12,40-47, cloudflare/disposition.ts:1-31, cloudflare/tickets.ts:51-58,80-86}`, `packages/framework/src/targets/cloudflare/tickets.ts:26-31`, `packages/framework/src/targets/cloudflare/stage.ts:134`.
- History: `git show 3a10800 -- docs/components/files.md`, `git show d4bf78f~1:packages/framework/src/files/local/route.ts`.
- Experiments E5 and E9: output quoted above. Their scripts (`exp.mjs`, `values.mts`) were in the session scratchpad and are not committed. E9 needs only `node:http`, `playwright-core` and Chromium, and can be re-created from the description.
