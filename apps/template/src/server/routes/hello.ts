import type { Hono } from "hono";
import type { Greeting } from "../../shared/types";
import type { Env } from "../env";

/** Configuration: anyone may read the greeting configured for this stage. */
export function helloRoutes(api: Hono<Env>): void {
  api.get("/hello", (c) => {
    const body: Greeting = { greeting: c.var.config.get("greeting") };
    return c.json(body);
  });
}
