import { jsonBody, requireAdmin, requireUser, z } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { Banner, Preferences, Site } from "../../shared/types";
import type { Env } from "../env";
import { pageSizeFor, pageSizeKey, pageSizeSchema } from "../preferences";

const BANNER_KEY = "site:banner";

const bannerChange = z.object({ message: z.string().trim().min(1).max(200).nullable() });
const preferencesChange = z.object({ pageSize: pageSizeSchema });

/** Configuration, the site banner (KV, DEMO-REQ-004) and the posts-per-page preference (KV, DEMO-REQ-005). */
export function siteRoutes(api: Hono<Env>): void {
  api.get("/site", async (c) => {
    const body: Site = {
      title: c.var.config.get("siteTitle"),
      maxPhotosPerPost: c.var.config.get("maxPhotosPerPost"),
      banner: await c.var.kv.get(BANNER_KEY),
    };
    return c.json(body);
  });

  api.get("/banner", async (c) => {
    const body: Banner = { message: await c.var.kv.get(BANNER_KEY) };
    return c.json(body);
  });

  api.put("/banner", requireAdmin(), jsonBody(bannerChange), async (c) => {
    const { message } = c.req.valid("json");
    if (message === null) await c.var.kv.delete(BANNER_KEY);
    else await c.var.kv.put(BANNER_KEY, message);
    c.var.log.write("site", "info", `banner ${message === null ? "cleared" : "set"} by ${c.var.user.id}`);
    const body: Banner = { message };
    return c.json(body);
  });

  api.get("/preferences", requireUser(), async (c) => {
    const body: Preferences = { pageSize: await pageSizeFor(c.var.kv, c.var.user) };
    return c.json(body);
  });

  api.put("/preferences", requireUser(), jsonBody(preferencesChange), async (c) => {
    const { pageSize } = c.req.valid("json");
    await c.var.kv.put(pageSizeKey(c.var.user.id), String(pageSize));
    const body: Preferences = { pageSize };
    return c.json(body);
  });
}
