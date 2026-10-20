import { jsonBody, requireAdmin, requireUser, z } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { Banner, Preferences, Site } from "../../shared/types";
import type { Env } from "../env";
import { BANNER_KEY, preferenceKey, readPageSize } from "../posts";

const bannerRequest = z.object({ banner: z.string().trim().max(500).nullable() });
const preferencesRequest = z.object({ pageSize: z.number().int().min(1).max(50) });

/** Site settings (configuration), the banner (KV, admin only) and each user's page size (KV). */
export function siteRoutes(api: Hono<Env>): void {
  api.get("/site", async (c) => {
    const body: Site = {
      title: c.var.config.get("siteTitle"),
      banner: await c.var.kv.get(BANNER_KEY),
      maxPhotosPerPost: c.var.config.get("maxPhotosPerPost"),
      shareLinkDays: c.var.config.get("shareLinkDays"),
    };
    return c.json(body);
  });

  // DEMO-REQ-004: an empty or null banner clears it.
  api.put("/banner", requireAdmin(), jsonBody(bannerRequest), async (c) => {
    const { banner } = c.req.valid("json");
    if (banner === null || banner === "") {
      await c.var.kv.delete(BANNER_KEY);
    } else {
      await c.var.kv.put(BANNER_KEY, banner);
    }
    c.var.log.write("banner", "info", `banner ${banner === null || banner === "" ? "cleared" : "set"} by ${c.var.user.id}`);
    const body: Banner = { banner: banner === "" ? null : banner };
    return c.json(body);
  });

  // DEMO-REQ-005: the posts-per-page choice is kept per user ID, so it survives logout and login.
  api.get("/preferences", requireUser(), async (c) => {
    const body: Preferences = { pageSize: await readPageSize(c.var.kv, c.var.user.id) };
    return c.json(body);
  });

  api.put("/preferences", requireUser(), jsonBody(preferencesRequest), async (c) => {
    const { pageSize } = c.req.valid("json");
    await c.var.kv.put(preferenceKey(c.var.user.id), JSON.stringify({ pageSize }));
    const body: Preferences = { pageSize };
    return c.json(body);
  });
}
