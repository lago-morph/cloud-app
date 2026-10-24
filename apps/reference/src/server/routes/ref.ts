import { FrameworkError, jsonBody, queryParams, z } from "@lago-morph/prototype-framework";
import type { ConfigValues } from "../../shared/types";
import { sha256Hex } from "../encoding";
import type { Api } from "../env";
import { SCHEMA_VERSION } from "../evolution";

const logRequest = z.object({ severity: z.enum(["debug", "info", "warn", "error"]), message: z.string() });
const echoBody = z.object({ text: z.string() });
const echoQuery = z.object({ text: z.string().min(1) });

const COOKIE_ATTRIBUTES = "Path=/; HttpOnly; SameSite=Lax";

/** Core, HTTP, LOG, CFG, SEC and AUTH fixtures (ROUTES.md "Core and HTTP fixtures"). */
export function refRoutes(api: Api): void {
  api.get("/ref/deployment", (c) => c.json({ deployment: c.var.deployment }));

  api.get("/ref/request-id", (c) => c.json({ requestId: c.var.requestId }));

  api.get("/ref/throw-plain", () => {
    throw new Error("reference plain error");
  });

  api.get("/ref/throw-secret", async (c) => {
    const value = await c.var.secrets.get("apiKey");
    throw new Error(`reference error carrying the secret ${value}`);
  });

  api.get("/ref/throw-secret-app", async (c) => {
    const value = await c.var.secrets.get("apiKey");
    throw new FrameworkError("HTTP.CONFLICT", `reference conflict carrying the secret ${value}`);
  });

  api.post("/ref/log", jsonBody(logRequest), (c) => {
    const { severity, message } = c.req.valid("json");
    c.var.log.write("reference", severity, message);
    return c.json({ requestId: c.var.requestId });
  });

  api.get("/ref/two-cookies", (c) => {
    c.header("Set-Cookie", `refOne=1; ${COOKIE_ATTRIBUTES}`, { append: true });
    c.header("Set-Cookie", `refTwo=2; ${COOKIE_ATTRIBUTES}`, { append: true });
    return c.json({ cookies: ["refOne", "refTwo"] });
  });

  api.post("/ref/echo", jsonBody(echoBody), (c) => c.json({ length: c.req.valid("json").text.length }));

  api.get("/ref/echo", queryParams(echoQuery), (c) => c.json({ text: c.req.valid("query").text }));

  api.get("/ref/config", (c) => {
    const body: ConfigValues = {
      greeting: c.var.config.get("greeting"),
      pageSize: c.var.config.get("pageSize"),
      featureOn: c.var.config.get("featureOn"),
      tags: c.var.config.get("tags"),
    };
    return c.json(body);
  });

  api.get("/ref/secret", async (c) => c.json({ sha256: await sha256Hex(await c.var.secrets.get("apiKey")) }));

  api.get("/ref/schema-version", (c) => c.json({ version: SCHEMA_VERSION }));

  api.get("/ref/me", (c) => c.json({ user: c.var.user }));
}
