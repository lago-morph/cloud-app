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
