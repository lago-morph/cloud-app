import { jsonBody, queryParams, requireUser, z } from "@lago-morph/prototype-framework";
import type { Api } from "../env";

const keyQuery = z.object({ key: z.string() });
const putBody = z.object({ key: z.string(), value: z.string() });
const listQuery = z.object({ prefix: z.string(), limit: z.coerce.number().int().optional(), cursor: z.string().optional() });

/** KV as given: keys, values and cursors reach the framework unchanged (ROUTES.md "KV"). */
export function kvRoutes(api: Api): void {
  api.get("/kv/value", requireUser(), queryParams(keyQuery), async (c) => c.json({ value: await c.var.kv.get(c.req.valid("query").key) }));

  api.put("/kv/value", requireUser(), jsonBody(putBody), async (c) => {
    const { key, value } = c.req.valid("json");
    await c.var.kv.put(key, value);
    return c.body(null, 204);
  });

  api.delete("/kv/value", requireUser(), queryParams(keyQuery), async (c) => {
    await c.var.kv.delete(c.req.valid("query").key);
    return c.body(null, 204);
  });

  api.get("/kv/list", requireUser(), queryParams(listQuery), async (c) => {
    const { prefix, limit, cursor } = c.req.valid("query");
    const page = await c.var.kv.list(prefix, { ...(limit === undefined ? {} : { limit }), ...(cursor === undefined ? {} : { cursor }) });
    return c.json(page);
  });
}
