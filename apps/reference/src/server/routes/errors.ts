import {
  defineTable,
  eq,
  FrameworkError,
  id,
  jsonBody,
  newId,
  queryParams,
  requireUser,
  z,
  type ConfigDeclaration,
  type ConfigService,
  type SecretsService,
} from "@lago-morph/prototype-framework";
import type { Api } from "../env";
import { authors, blobs, posts } from "../schema";

/** The answer of an outage route whose condition is absent. */
const NOT_RAISED = { raised: false } as const;

/** Over PAR-215 (256 KiB) in one row: the result size limit is crossed by a single value. */
const OVERSIZED_TEXT_LENGTH = 300_000;

/** Over PAR-223 (4,096 UTF-8 bytes). */
const KV_VALUE_OVER_LIMIT = 4_097;

/** The route path of a code: one literal route per code, so the logged route path is the request path. */
const at = (code: string): string => `/errors/${code}`;

/**
 * One route per catalogue code with an HTTP status (ROUTES.md "Error routes"). App code throws
 * only the CORE-REQ-007 codes; every other code is raised by the framework, by doing what causes it.
 */
export function errorRoutes(api: Api): void {
  api.get(at("CORE.INTERNAL"), () => {
    throw new Error("reference error route: plain Error");
  });

  api.get(at("CORE.MISCONFIGURED"), (c) => {
    // A schema rule violation (table names are lowercase snake_case) is CORE.MISCONFIGURED.
    defineTable("Not-A-Valid-Table", { id: id() });
    return c.json(NOT_RAISED);
  });

  api.get(at("HTTP.INVALID_INPUT"), queryParams(z.object({ value: z.string().min(1) })), (c) => c.json(NOT_RAISED));

  api.get(at("HTTP.NOT_FOUND"), () => {
    throw new FrameworkError("HTTP.NOT_FOUND", "reference error route: no such resource");
  });

  // Registered for POST only, so a GET is 405.
  api.post(at("HTTP.METHOD_NOT_ALLOWED"), (c) => c.json(NOT_RAISED));

  api.post(at("HTTP.PAYLOAD_TOO_LARGE"), jsonBody(z.object({ text: z.string() })), (c) => c.json(NOT_RAISED));

  api.get(at("HTTP.CONFLICT"), () => {
    throw new FrameworkError("HTTP.CONFLICT", "reference error route: state does not allow this");
  });

  api.get(at("SQL.CONFLICT"), async (c) => {
    const name = `errors-route-conflict-${newId()}`;
    await c.var.sql.insert(authors).values({ id: newId(), name });
    try {
      await c.var.sql.insert(authors).values({ id: newId(), name });
    } finally {
      await c.var.sql.delete(authors).where(eq(authors.name, name));
    }
    return c.json(NOT_RAISED);
  });

  api.get(at("SQL.INVALID_VALUE"), async (c) => {
    // 2^31 is outside integer()'s signed 32-bit range; the value rule rejects it before the database.
    await c.var.sql.insert(posts).values({ id: newId(), authorId: newId(), title: "invalid", votes: 2147483648, createdAt: 0 });
    return c.json(NOT_RAISED);
  });

  api.get(at("SQL.UNAVAILABLE"), async (c) => {
    await c.var.sql.select({ id: authors.id }).from(authors).limit(1);
    return c.json(NOT_RAISED);
  });

  api.get(at("SQL.RESULT_TOO_LARGE"), async (c) => {
    const blobId = newId();
    await c.var.sql.insert(blobs).values({ id: blobId, body: "x".repeat(OVERSIZED_TEXT_LENGTH) });
    try {
      await c.var.sql.select({ body: blobs.body }).from(blobs).where(eq(blobs.id, blobId));
    } finally {
      await c.var.sql.delete(blobs).where(eq(blobs.id, blobId));
    }
    return c.json(NOT_RAISED);
  });

  api.get(at("KV.INVALID_KEY"), async (c) => {
    await c.var.kv.get("");
    return c.json(NOT_RAISED);
  });

  api.get(at("KV.INVALID_CURSOR"), async (c) => {
    await c.var.kv.list("ref:", { cursor: "not-a-cursor" });
    return c.json(NOT_RAISED);
  });

  api.get(at("KV.VALUE_TOO_LARGE"), async (c) => {
    await c.var.kv.put("ref:too-large", "x".repeat(KV_VALUE_OVER_LIMIT));
    return c.json(NOT_RAISED);
  });

  api.get(at("KV.UNAVAILABLE"), async (c) => {
    await c.var.kv.get("ref:probe");
    return c.json(NOT_RAISED);
  });

  api.get(at("FILES.INVALID_NAME"), async (c) => {
    await c.var.files.head("");
    return c.json(NOT_RAISED);
  });

  api.get(at("FILES.INVALID_CURSOR"), async (c) => {
    await c.var.files.list("ref/", { cursor: "not-a-cursor" });
    return c.json(NOT_RAISED);
  });

  api.get(at("FILES.NOT_FOUND"), async (c) => {
    await c.var.files.createDownloadTicket(`ref/missing-${newId()}`);
    return c.json(NOT_RAISED);
  });

  api.get(at("FILES.UNAVAILABLE"), async (c) => {
    await c.var.files.head("ref/probe");
    return c.json(NOT_RAISED);
  });

  api.get(at("CFG.UNDECLARED_KEY"), (c) => {
    // Seen through the general service type, any key name type-checks; the framework rejects it.
    const anyConfig: ConfigService<ConfigDeclaration> = c.var.config;
    anyConfig.get("undeclaredKey");
    return c.json(NOT_RAISED);
  });

  api.get(at("SEC.UNDECLARED"), async (c) => {
    const anySecrets: SecretsService<string> = c.var.secrets;
    await anySecrets.get("undeclaredSecret");
    return c.json(NOT_RAISED);
  });

  api.get(at("SEC.MISSING"), async (c) => {
    await c.var.secrets.get("apiKey");
    return c.json(NOT_RAISED);
  });

  api.get(at("SEC.UNAVAILABLE"), async (c) => {
    await c.var.secrets.get("apiKey");
    return c.json(NOT_RAISED);
  });

  api.get(at("AUTH.UNAUTHENTICATED"), requireUser(), (c) => c.json(NOT_RAISED));

  api.get(at("AUTH.FORBIDDEN"), () => {
    throw new FrameworkError("AUTH.FORBIDDEN", "reference error route: you may see this but not change it");
  });

  // The framework's forgery check answers before the handler for a session with a wrong Origin.
  api.post(at("AUTH.REQUEST_FORGERY"), (c) => c.json(NOT_RAISED));
}
