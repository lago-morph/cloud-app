# Example: uploading and downloading files with tickets

Every file below is copied unchanged from the framework's app template (`apps/template`) or its compliance reference app (`apps/reference`). The framework's CI type-checks and tests those apps (`npm run verify` runs each app's `verify`), so this code compiles and passes as shown. Do not copy code from any other app.

What it shows:

- `routes/files.ts`: the server builds every file name itself (a per-user folder plus a validated plain name), lists the user's files, and issues upload tickets with an explicit content type and download tickets.
- `pages/files.ts`: the browser asks for a ticket, calls `uploadFile` with progress, and opens `downloadUrl(ticket)`; it asks for a fresh download ticket on every click.

## `apps/template/src/server/routes/files.ts`

<!-- example-source: apps/template/src/server/routes/files.ts -->
```ts
import { jsonBody, requireUser, z } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { FileList } from "../../shared/types";
import type { Env } from "../env";

/** A plain file name: no slashes, so a user can only reach their own folder. */
const fileName = z.string().min(1).max(100).regex(/^[^/\\]+$/);
const uploadRequest = z.object({ name: fileName, contentType: z.string().min(1).max(100) });
const downloadRequest = z.object({ name: fileName });

function folder(userId: string): string {
  return `users/${userId}/`;
}

/** FILES: the browser uploads and downloads directly with tickets the server issues. */
export function fileRoutes(api: Hono<Env>): void {
  api.get("/files", requireUser(), async (c) => {
    const prefix = folder(c.var.user.id);
    const page = await c.var.files.list(prefix);
    const body: FileList = {
      files: page.items.map((f) => ({ name: f.name.slice(prefix.length), size: f.size, contentType: f.contentType })),
    };
    return c.json(body);
  });

  api.post("/files/upload-ticket", requireUser(), jsonBody(uploadRequest), async (c) => {
    const { name, contentType } = c.req.valid("json");
    const ticket = await c.var.files.createUploadTicket(folder(c.var.user.id) + name, { contentType });
    return c.json({ ticket });
  });

  api.post("/files/download-ticket", requireUser(), jsonBody(downloadRequest), async (c) => {
    const { name } = c.req.valid("json");
    const ticket = await c.var.files.createDownloadTicket(folder(c.var.user.id) + name);
    return c.json({ ticket });
  });
}
```

## `apps/template/src/client/pages/files.ts`

<!-- example-source: apps/template/src/client/pages/files.ts -->
```ts
import { api, downloadUrl, uploadFile, type DownloadTicket, type UploadTicket } from "@lago-morph/prototype-framework/client";
import type { FileList } from "../../shared/types";
import { describeError, el, section } from "../dom";

/** Upload a file and download your files (FILES, through tickets). */
export function filesPage(): HTMLElement {
  const page = section("Files");
  const picker = el("input");
  picker.type = "file";
  const upload = el("button", "Upload");
  const message = el("p");
  const list = el("ul");
  page.append(picker, upload, message, list);

  async function download(name: string): Promise<void> {
    const { ticket } = await api<{ ticket: DownloadTicket }>("/files/download-ticket", { method: "POST", body: { name } });
    window.open(downloadUrl(ticket), "_blank", "noopener");
  }

  async function refresh(): Promise<void> {
    const { files } = await api<FileList>("/files");
    list.replaceChildren(
      ...files.map((f) => {
        const item = el("li", `${f.name} (${f.size} bytes) `);
        const button = el("button", "Download");
        button.addEventListener("click", () => {
          void download(f.name).catch((error: unknown) => {
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
    void api<{ ticket: UploadTicket }>("/files/upload-ticket", { method: "POST", body: { name: file.name, contentType } })
      .then(({ ticket }) =>
        uploadFile(ticket, file, {
          onProgress: (p) => {
            message.textContent = `Uploading… ${p.loaded} of ${p.total} bytes`;
          },
        }),
      )
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
