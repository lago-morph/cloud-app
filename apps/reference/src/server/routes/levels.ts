import { requireAdmin, requireCurrentUser, requireUser } from "@lago-morph/prototype-framework";
import type { Api } from "../env";

/** Protected routes per access level (AUTH-AC-004, E2E-005). */
export function levelRoutes(api: Api): void {
  api.get("/levels/anyone", (c) => c.json({ level: c.var.user.level }));

  for (const method of ["get", "post"] as const) {
    api[method]("/levels/user", requireUser(), (c) => c.json({ level: c.var.user.level, id: c.var.user.id }));
    api[method]("/levels/admin", requireAdmin(), (c) => c.json({ level: c.var.user.level, id: c.var.user.id }));
  }

  api.get("/levels/current", (c) => {
    const user = requireCurrentUser(c);
    return c.json({ level: user.level, id: user.id });
  });
}
