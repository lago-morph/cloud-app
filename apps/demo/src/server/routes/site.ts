import { jsonBody, requireAdmin, requireUser, z, type KvService } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { Banner, Preferences, SiteInfo } from "../../shared/types";
import type { Env } from "../env";

const BANNER_KEY = "site:banner";
const DEFAULT_PER_PAGE = 10;

const bannerInput = z.object({ banner: z.string().trim().max(300) });
const preferencesInput = z.object({ perPage: z.number().int().min(1).max(50) });
const storedPerPage = z.coerce.number().int().min(1).max(50);

function perPageKey(userId: string): string {
  return `pref:${userId}:perPage`;
}

/** The user's stored posts-per-page choice, or `fallback`. */
export async function readPerPage(kv: KvService, userId: string, fallback: number): Promise<number> {
  const stored = await kv.get(perPageKey(userId));
  if (stored === null) return fallback;
  const parsed = storedPerPage.safeParse(stored);
  return parsed.success ? parsed.data : fallback;
}

/** Configuration and KV: the site title and banner, and each user's posts-per-page preference. */
export function siteRoutes(api: Hono<Env>): void {
  api.get("/site", async (c) => {
    const body: SiteInfo = {
      title: c.var.config.get("siteTitle"),
      banner: await c.var.kv.get(BANNER_KEY),
      maxPhotosPerPost: c.var.config.get("maxPhotosPerPost"),
      shareLinkDays: c.var.config.get("shareLinkDays"),
    };
    return c.json(body);
  });

  // An empty banner clears it.
  api.put("/banner", requireAdmin(), jsonBody(bannerInput), async (c) => {
    const { banner } = c.req.valid("json");
    if (banner === "") await c.var.kv.delete(BANNER_KEY);
    else await c.var.kv.put(BANNER_KEY, banner);
    c.var.log.write("site", "info", banner === "" ? "banner cleared" : "banner set");
    const body: Banner = { banner: banner === "" ? null : banner };
    return c.json(body);
  });

  api.get("/preferences", requireUser(), async (c) => {
    const body: Preferences = { perPage: await readPerPage(c.var.kv, c.var.user.id, DEFAULT_PER_PAGE) };
    return c.json(body);
  });

  api.put("/preferences", requireUser(), jsonBody(preferencesInput), async (c) => {
    const { perPage } = c.req.valid("json");
    await c.var.kv.put(perPageKey(c.var.user.id), String(perPage));
    const body: Preferences = { perPage };
    return c.json(body);
  });
}
