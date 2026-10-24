# Example: uploading, finalizing and downloading files with tickets

Every file below is copied unchanged from the framework's app template (`apps/template`) or its compliance reference app (`apps/reference`). The framework's CI type-checks and tests those apps (`npm run verify` runs each app's `verify`), so this code compiles and passes as shown. Do not copy code from any other app.

What it shows:

- `routes/files.ts`: the safe upload pattern. The server builds every storage name itself (`uploads/<userId>/<newId()>`) and issues the upload ticket with an explicit content type. A finalize route calls `head`, deletes an upload that is missing, too large or of a type it does not accept, and only then inserts the `uploads` row. Listings and download tickets come from those rows, filtered by the user's ID, never from file names.
- `pages/files.ts`: the browser asks for a ticket, calls `uploadFile` with progress, calls the finalize route, and opens `downloadUrl(ticket)`; it asks for a fresh download ticket on every click.
- The tests that drive it, including the oversized and wrong-type uploads, are in `tests/app.test.ts` ([tests.md](tests.md)). The `uploads` table is in `schema.ts` ([notes-sql.md](notes-sql.md)).

## `apps/template/src/server/routes/files.ts`

<!-- example-source: apps/template/src/server/routes/files.ts -->
```ts
import { FrameworkError, and, desc, eq, jsonBody, newId, now, requireUser, z } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { FileList, StoredFile } from "../../shared/types";
import type { Env } from "../env";
import { uploads } from "../schema";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES: readonly string[] = ["text/plain", "application/pdf", "image/png", "image/jpeg"];

const uploadRequest = z.object({ contentType: z.string().min(1).max(100) });
/** The display name is a record field, never part of the storage name. */
const finalizeRequest = z.object({ id: z.uuid(), name: z.string().min(1).max(100).regex(/^[^/\\]+$/) });
const downloadRequest = z.object({ id: z.uuid() });

/** The server builds every storage name from trusted parts: the user's ID and a fresh `newId()`. */
function storageName(userId: string, uploadId: string): string {
  return `uploads/${userId}/${uploadId}`;
}

/** FILES: the browser uploads and downloads directly with tickets; a finalize route checks each upload. */
export function fileRoutes(api: Hono<Env>): void {
  api.get("/files", requireUser(), async (c) => {
    const rows = await c.var.sql
      .select({ id: uploads.id, name: uploads.name, size: uploads.size, contentType: uploads.contentType })
      .from(uploads)
      .where(eq(uploads.ownerId, c.var.user.id))
      .orderBy(desc(uploads.createdAt), desc(uploads.id))
      .limit(50);
    const body: FileList = { files: rows };
    return c.json(body);
  });

  api.post("/files/upload-ticket", requireUser(), jsonBody(uploadRequest), async (c) => {
    const id = newId();
    const { contentType } = c.req.valid("json");
    const ticket = await c.var.files.createUploadTicket(storageName(c.var.user.id, id), { contentType });
    return c.json({ id, ticket });
  });

  // Called by the browser after `uploadFile` resolves. Nothing lists the file until this creates its row.
  api.post("/files/finalize", requireUser(), jsonBody(finalizeRequest), async (c) => {
    const { id, name } = c.req.valid("json");
    const file = await c.var.files.head(storageName(c.var.user.id, id));
    if (file === null) throw new FrameworkError("HTTP.NOT_FOUND", "no such upload");
    if (file.size > MAX_BYTES || !ACCEPTED_TYPES.includes(file.contentType)) {
      await c.var.files.delete(file.name);
      throw new FrameworkError("HTTP.CONFLICT", `files must be at most ${MAX_BYTES} bytes and one of: ${ACCEPTED_TYPES.join(", ")}`);
    }
    const row: StoredFile = { id, name, size: file.size, contentType: file.contentType };
    await c.var.sql.insert(uploads).values({ ...row, ownerId: c.var.user.id, createdAt: now() });
    return c.json(row, 201);
  });

  api.post("/files/download-ticket", requireUser(), jsonBody(downloadRequest), async (c) => {
    const { id } = c.req.valid("json");
    const [row] = await c.var.sql
      .select({ id: uploads.id })
      .from(uploads)
      .where(and(eq(uploads.id, id), eq(uploads.ownerId, c.var.user.id)));
    if (row === undefined) throw new FrameworkError("HTTP.NOT_FOUND", "no such file");
    const ticket = await c.var.files.createDownloadTicket(storageName(c.var.user.id, row.id));
    return c.json({ ticket });
  });
}
```

## `apps/template/src/client/pages/files.ts`

<!-- example-source: apps/template/src/client/pages/files.ts -->
```ts
import { api, downloadUrl, uploadFile, type DownloadTicket, type UploadTicket } from "@lago-morph/prototype-framework/client";
import type { FileList, StoredFile } from "../../shared/types";
import { describeError, el, section } from "../dom";

/** Upload a file, finalize it, and download your files (FILES, through tickets). */
export function filesPage(): HTMLElement {
  const page = section("Files");
  const picker = el("input");
  picker.type = "file";
  const upload = el("button", "Upload");
  const message = el("p");
  const list = el("ul");
  page.append(picker, upload, message, list);

  async function download(id: string): Promise<void> {
    const { ticket } = await api<{ ticket: DownloadTicket }>("/files/download-ticket", { method: "POST", body: { id } });
    window.open(downloadUrl(ticket), "_blank", "noopener");
  }

  async function refresh(): Promise<void> {
    const { files } = await api<FileList>("/files");
    list.replaceChildren(
      ...files.map((f) => {
        const item = el("li", `${f.name} (${f.size} bytes) `);
        const button = el("button", "Download");
        button.addEventListener("click", () => {
          void download(f.id).catch((error: unknown) => {
            message.textContent = describeError(error);
          });
        });
        item.append(button);
        return item;
      }),
    );
  }

  upload.addEventListener("click", () => {
    const file = picker.files?.[0];
    if (file === undefined) {
      message.textContent = "Choose a file first.";
      return;
    }
    message.textContent = "Uploading…";
    const contentType = file.type === "" ? "application/octet-stream" : file.type;
    void api<{ id: string; ticket: UploadTicket }>("/files/upload-ticket", { method: "POST", body: { contentType } })
      .then(async ({ id, ticket }) => {
        await uploadFile(ticket, file, {
          onProgress: (p) => {
            message.textContent = `Uploading… ${p.loaded} of ${p.total} bytes`;
          },
        });
        return api<StoredFile>("/files/finalize", { method: "POST", body: { id, name: file.name } });
      })
      .then(() => {
        message.textContent = "Uploaded.";
        return refresh();
      })
      .catch((error: unknown) => {
        message.textContent = describeError(error);
      });
  });

  void refresh().catch((error: unknown) => {
    message.textContent = describeError(error);
  });
  return page;
}
```
