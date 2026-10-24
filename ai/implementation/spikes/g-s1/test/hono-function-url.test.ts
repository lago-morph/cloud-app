/**
 * Q3: hono 4.13.13 `hono/aws-lambda` with Function URL (payload 2.0) events; two Set-Cookie
 * headers must come out as `cookies: [a, b]` (AWS-AC-006 offline part). No network.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Context } from "aws-lambda";
import { Hono } from "hono";
import { handle, type LambdaEvent } from "hono/aws-lambda";
import { setCookie } from "hono/cookie";
import { describe, expect, it } from "vitest";
import { getWithCookies, postBase64, postJson, unknownPath } from "../fixtures/function-url-events.js";

const app = new Hono();
app.get("/api/login", (c) => {
  setCookie(c, "session", "s1", { httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
  setCookie(c, "login_state", "st", { httpOnly: true, secure: true, sameSite: "Lax", path: "/api", maxAge: 600 });
  return c.json({
    url: c.req.url,
    cookieHeader: c.req.header("cookie") ?? null,
    host: c.req.header("host") ?? null,
    next: c.req.query("next") ?? null,
  });
});
app.post("/api/echo", async (c) => c.json({ got: await c.req.json<unknown>() }, 201));
app.notFound((c) => c.json({ error: { code: "HTTP.NOT_FOUND", message: "no such route" } }, 404));

const lambda = handle(app);
const ctx = {} as Context;

/**
 * hono's own event types do not match @types/aws-lambda's `APIGatewayProxyEventV2` (nor real
 * Function URL events): hono requires `body: string | null` and `requestContext.authorizer` /
 * `authentication`, which a Function URL GET with auth type NONE leaves out. So the entry takes
 * the @types/aws-lambda type and crosses into hono with one boundary cast to `LambdaEvent`.
 */
async function invoke(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  return (await lambda(event as unknown as LambdaEvent, ctx)) as APIGatewayProxyStructuredResultV2;
}

describe("hono/aws-lambda with Function URL v2 events", () => {
  it("maps path, query, request cookies and emits two Set-Cookie values as cookies[]", async () => {
    const res = await invoke(getWithCookies);
    expect(res.statusCode).toBe(200);
    expect(res.cookies).toEqual([
      "session=s1; Path=/; HttpOnly; Secure; SameSite=Lax",
      "login_state=st; Max-Age=600; Path=/api; HttpOnly; Secure; SameSite=Lax",
    ]);
    // Set-Cookie must not also appear (folded) in headers.
    expect(Object.keys(res.headers ?? {}).map((k) => k.toLowerCase())).not.toContain("set-cookie");
    const body = JSON.parse(res.body ?? "") as Record<string, unknown>;
    expect(body).toMatchObject({ cookieHeader: "a=1; b=two", next: "/notes" });
    // The request URL is built from the Host header: AWS-AC-004 means the framework must take
    // its origin from configuration, not from this.
    expect(body["url"]).toBe("https://abcdefghijklmnopqrstuvwxyz012345.lambda-url.us-east-1.on.aws/api/login?next=%2Fnotes");
  });

  it("passes a JSON body and the status through", async () => {
    const res = await invoke(postJson);
    expect(res.statusCode).toBe(201);
    expect(res.isBase64Encoded).toBe(false);
    expect(JSON.parse(res.body ?? "")).toEqual({ got: { hello: "world" } });
    expect(res.cookies).toBeUndefined();
  });

  it("decodes a base64 request body", async () => {
    const res = await invoke(postBase64);
    expect(JSON.parse(res.body ?? "")).toEqual({ got: { b: 64 } });
  });

  it("keeps a JSON 404 body for an unknown API path", async () => {
    const res = await invoke(unknownPath);
    expect(res.statusCode).toBe(404);
    expect(res.headers?.["content-type"]).toMatch(/application\/json/);
    expect(JSON.parse(res.body ?? "")).toEqual({ error: { code: "HTTP.NOT_FOUND", message: "no such route" } });
  });
});
