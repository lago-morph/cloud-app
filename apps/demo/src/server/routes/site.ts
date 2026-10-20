import { jsonBody, requireAdmin, requireUser, z } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { Banner, Preferences, Site } from "../../shared/types";
import type { Env } from "../env";
import { perPageSchema, readPerPage, writePerPage } from "../preferences";

const BANNER_KEY = "site:banner";
const bannerChange = z.object({ banner: z.string().trim().max(500).nullable() });
const preferenceChange = z.object({ perPage: perPageSchema });

/** Site settings (configuration, DEMO-REQ-006), the banner (KV, DEMO-REQ-004) and the per-user preference (KV, DEMO-REQ-005). */
export function siteRoutes(api: Hono<Env>): void {
  api.get("/site", async (c) => {
    const result: Site = {
      title: c.var.config.get("siteTitle"),
      banner: await c.var.kv.get(BANNER_KEY),
      maxPhotosPerPost: c.var.config.get("maxPhotosPerPost"),
      shareLinkDays: c.var.config.get("shareLinkDays"),
    };
    return c.json(result);
  });

  // Sets the banner; null or blank clears it.
  api.put("/banner", requireAdmin(), jsonBody(bannerChange), async (c) => {
    const { banner } = c.req.valid("json");
    if (banner === null || banner === "") {
      await c.var.kv.delete(BANNER_KEY);
    } else {
      await c.var.kv.put(BANNER_KEY, banner);
    }
    const result: Banner = { banner: banner === "" ? null : banner };
    return c.json(result);
  });

  api.get("/preferences", requireUser(), async (c) => {
    const result: Preferences = { perPage: await readPerPage(c.var.kv, c.var.user) };
    return c.json(result);
  });

  api.put("/preferences", requireUser(), jsonBody(preferenceChange), async (c) => {
    const { perPage } = c.req.valid("json");
    await writePerPage(c.var.kv, c.var.user.id, perPage);
    const result: Preferences = { perPage };
    return c.json(result);
  });
}
