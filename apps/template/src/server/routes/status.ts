import { jsonBody, requireUser, z } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { Status } from "../../shared/types";
import type { Env } from "../env";

const newStatus = z.object({ status: z.string().max(100) });

/** KV: each logged-in user has one status line. */
export function statusRoutes(api: Hono<Env>): void {
  api.get("/status", requireUser(), async (c) => {
    const body: Status = { status: await c.var.kv.get(`status:${c.var.user.id}`) };
    return c.json(body);
  });

  api.put("/status", requireUser(), jsonBody(newStatus), async (c) => {
    const { status } = c.req.valid("json");
    await c.var.kv.put(`status:${c.var.user.id}`, status);
    const body: Status = { status };
    return c.json(body);
  });
}
