import { requireAdmin } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { SecretCheck } from "../../shared/types";
import type { Env } from "../env";

/** Secrets and access levels: only an admin may check that the secret is set. Never return its value. */
export function adminRoutes(api: Hono<Env>): void {
  api.get("/admin/secret", requireAdmin(), async (c) => {
    const apiKey = await c.var.secrets.get("apiKey");
    const body: SecretCheck = { configured: apiKey.length > 0 };
    return c.json(body);
  });
}
