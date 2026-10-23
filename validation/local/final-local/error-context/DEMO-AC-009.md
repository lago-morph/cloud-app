# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/compliance/e2e/demo-pages.spec.ts >> [DEMO-AC-009] with clipboard permissions granted, the account page's copy button puts exactly the /api/auth/me user ID on the clipboard
- Location: tests/compliance/e2e/demo-pages.spec.ts:261:1

# Error details

```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('link', { name: /account/i }).first()

```

# Test source

```ts
  175 | 
  176 |     await page.getByRole("button", { name: ASSUMED_PUBLISH_BUTTON }).first().click({ timeout: 30_000 });
  177 |     await expect(page.getByRole("button", { name: ASSUMED_PUBLISH_BUTTON }), "published").toHaveCount(0, { timeout: 30_000 });
  178 | 
  179 |     // The anonymous visitor: the published list, then the post itself.
  180 |     await visitor.page.goto("/");
  181 |     await expectTitleAsText(visitor.page, title, marker);
  182 |     await openFromList(visitor.page, title);
  183 |     await expectTitleAsText(visitor.page, title, marker);
  184 |   } finally {
  185 |     if (created) {
  186 |       await openFromList(author.page, title).catch(() => undefined);
  187 |       await deleteThroughPage(author.page);
  188 |     }
  189 |     await Promise.all([author.context.close(), visitor.context.close()]);
  190 |   }
  191 | });
  192 | 
  193 | /** A baseline JPEG of random pixels encoded by the browser at quality 1, at least MIN_JPEG_BYTES. */
  194 | async function makeLargeJpeg(page: Page): Promise<Buffer> {
  195 |   const base64 = await page.evaluate(
  196 |     async ([w, h]) => {
  197 |       const canvas = new OffscreenCanvas(w, h);
  198 |       const ctx = canvas.getContext("2d");
  199 |       if (ctx === null) throw new Error("no 2d context");
  200 |       const image = ctx.createImageData(w, h);
  201 |       let s = 20;
  202 |       for (let i = 0; i < image.data.length; i += 4) {
  203 |         s = (Math.imul(s, 1103515245) + 12345) >>> 0;
  204 |         image.data[i] = s & 255;
  205 |         image.data[i + 1] = (s >>> 8) & 255;
  206 |         image.data[i + 2] = (s >>> 16) & 255;
  207 |         image.data[i + 3] = 255;
  208 |       }
  209 |       ctx.putImageData(image, 0, 0);
  210 |       const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 1 });
  211 |       const bytes = new Uint8Array(await blob.arrayBuffer());
  212 |       let binary = "";
  213 |       for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  214 |       return btoa(binary);
  215 |     },
  216 |     [PHOTO_WIDTH, PHOTO_HEIGHT] as const,
  217 |   );
  218 |   const jpeg = Buffer.from(base64, "base64");
  219 |   expect(jpeg.subarray(0, 3).toString("hex"), "JPEG signature").toBe("ffd8ff");
  220 |   expect(jpeg.length, "the photo is at least 20 MB").toBeGreaterThanOrEqual(MIN_JPEG_BYTES);
  221 |   return jpeg;
  222 | }
  223 | 
  224 | /** The size of each image on the page that has finished loading ("loading" for one that has not). */
  225 | function imageSizes(page: Page): Promise<string[]> {
  226 |   return page.evaluate(() => Array.from(document.images, (img) => (img.complete ? `${String(img.naturalWidth)}x${String(img.naturalHeight)}` : "loading")));
  227 | }
  228 | 
  229 | test(tag("DEMO-AC-003", "a JPEG of at least 20 MB attached through the page displays: an image on the post is complete with naturalWidth > 0, at the photo's size"), async ({ browser }) => {
  230 |   test.setTimeout(15 * 60_000);
  231 |   const suffix = randomSuffix(4);
  232 |   const title = `Large photo ${suffix}`;
  233 |   const author = await session(browser, "user", `demo-pages-photo-${suffix}`);
  234 |   let created = false;
  235 |   try {
  236 |     const page = author.page;
  237 |     const jpeg = await makeLargeJpeg(page);
  238 |     await createDraftAndOpen(page, title);
  239 |     created = true;
  240 |     const postUrl = page.url();
  241 |     expect(await imageSizes(page), "the post shows no photo before the upload").not.toContain(`${String(PHOTO_WIDTH)}x${String(PHOTO_HEIGHT)}`);
  242 | 
  243 |     await page.locator('input[type="file"]').first().setInputFiles({ name: `large-${suffix}.jpg`, mimeType: "image/jpeg", buffer: jpeg });
  244 |     const attach = page.getByRole("button", { name: ASSUMED_ATTACH_BUTTON });
  245 |     if ((await attach.count()) > 0) await attach.first().click();
  246 | 
  247 |     // Displays: an image on the post finishes loading at the photo's own size (naturalWidth > 0).
  248 |     const shown = `${String(PHOTO_WIDTH)}x${String(PHOTO_HEIGHT)}`;
  249 |     await expect.poll(() => imageSizes(page), { timeout: 10 * 60_000, intervals: [2_000] }).toContain(shown);
  250 |     // And again on a fresh load of the post, so it is the stored photo, not a local preview.
  251 |     await page.goto(postUrl);
  252 |     await expect.poll(() => imageSizes(page), { timeout: 5 * 60_000, intervals: [2_000] }).toContain(shown);
  253 |     const widths = await page.evaluate(() => Array.from(document.images, (img) => img.naturalWidth));
  254 |     expect(Math.max(0, ...widths), "naturalWidth > 0").toBeGreaterThan(0);
  255 |   } finally {
  256 |     if (created) await deleteThroughPage(author.page);
  257 |     await author.context.close();
  258 |   }
  259 | });
  260 | 
  261 | test(tag("DEMO-AC-009", "with clipboard permissions granted, the account page's copy button puts exactly the /api/auth/me user ID on the clipboard"), async ({ browser }) => {
  262 |   test.setTimeout(120_000);
  263 |   const suffix = randomSuffix(4);
  264 |   const user = await session(browser, "user", `demo-pages-copy-${suffix}`);
  265 |   try {
  266 |     const page = user.page;
  267 |     await user.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: origin() });
  268 |     const me = await page.request.get("/api/auth/me");
  269 |     expect(me.status()).toBe(200);
  270 |     const { id } = (await me.json()) as { id: string };
  271 |     expect(id).toBe(`demo-pages-copy-${suffix}`);
  272 | 
  273 |     // The account page, reached through the page's own navigation.
  274 |     await page.goto("/");
> 275 |     await page.getByRole("link", { name: ASSUMED_ACCOUNT_LINK }).first().click({ timeout: 30_000 });
      |                                                                          ^ TimeoutError: locator.click: Timeout 30000ms exceeded.
  276 |     const copy = page.getByRole("button", { name: ASSUMED_COPY_BUTTON });
  277 |     await expect(copy.first()).toBeVisible({ timeout: 30_000 });
  278 |     // Something else on the clipboard first, so only the copy button can put the ID there.
  279 |     const sentinel = `not-the-id-${suffix}`;
  280 |     await page.evaluate((text) => navigator.clipboard.writeText(text), sentinel);
  281 |     expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sentinel);
  282 | 
  283 |     await copy.first().click();
  284 |     await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 10_000 }).toBe(id);
  285 |   } finally {
  286 |     await user.context.close();
  287 |   }
  288 | });
  289 | 
```