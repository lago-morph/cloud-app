import { jsonBody, queryParams, requireUser, z } from "@lago-morph/prototype-framework";
import { fromBase64, readAll, toBase64 } from "../encoding";
import type { Api } from "../env";

const nameQuery = z.object({ name: z.string() });
const listQuery = z.object({ prefix: z.string(), limit: z.coerce.number().int().optional(), cursor: z.string().optional() });
const putBody = z.object({ name: z.string(), contentType: z.string().optional(), base64: z.string() });
const uploadBody = z.object({ name: z.string(), contentType: z.string().optional() });
const downloadBody = z.object({ name: z.string() });

/** FILES as given: names reach the framework unchanged, no prefix added (ROUTES.md "Files"). */
export function fileRoutes(api: Api): void {
  api.get("/files/list", requireUser(), queryParams(listQuery), async (c) => {
    const { prefix, limit, cursor } = c.req.valid("query");
    const page = await c.var.files.list(prefix, { ...(limit === undefined ? {} : { limit }), ...(cursor === undefined ? {} : { cursor }) });
    return c.json({ items: page.items.map((f) => ({ name: f.name, size: f.size, contentType: f.contentType })), nextCursor: page.nextCursor });
  });

  api.get("/files/head", requireUser(), queryParams(nameQuery), async (c) => {
    const info = await c.var.files.head(c.req.valid("query").name);
    return c.json({ file: info === null ? null : { name: info.name, size: info.size, contentType: info.contentType } });
  });

  api.get("/files/content", requireUser(), queryParams(nameQuery), async (c) => {
    const content = await c.var.files.get(c.req.valid("query").name);
    if (content === null) return c.json({ file: null });
    const base64 = toBase64(await readAll(content.body));
    return c.json({ file: { name: content.name, size: content.size, contentType: content.contentType, base64 } });
  });

  api.put("/files/content", requireUser(), jsonBody(putBody), async (c) => {
    const { name, contentType, base64 } = c.req.valid("json");
    await c.var.files.put(name, fromBase64(base64), contentType === undefined ? {} : { contentType });
    return c.body(null, 204);
  });

  api.delete("/files/content", requireUser(), queryParams(nameQuery), async (c) => {
    await c.var.files.delete(c.req.valid("query").name);
    return c.body(null, 204);
  });

  api.post("/files/upload-ticket", requireUser(), jsonBody(uploadBody), async (c) => {
    const { name, contentType } = c.req.valid("json");
    const ticket = await c.var.files.createUploadTicket(name, contentType === undefined ? {} : { contentType });
    return c.json({ ticket });
  });

  api.post("/files/download-ticket", requireUser(), jsonBody(downloadBody), async (c) => {
    const ticket = await c.var.files.createDownloadTicket(c.req.valid("json").name);
    return c.json({ ticket });
  });
}
