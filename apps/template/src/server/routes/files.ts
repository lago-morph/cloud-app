import { FrameworkError, and, desc, eq, jsonBody, newId, now, requireUser, z } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { FileList, StoredFile } from "../../shared/types";
import type { Env } from "../env";
import { uploads } from "../schema";

/** No size cap: uploads are limited only by storage's single-upload maximum (PAR-234). */
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
    if (!ACCEPTED_TYPES.includes(file.contentType)) {
      await c.var.files.delete(file.name);
      throw new FrameworkError("HTTP.CONFLICT", `files must be one of: ${ACCEPTED_TYPES.join(", ")}`);
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
