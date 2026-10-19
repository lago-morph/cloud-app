// Minimal Worker: Hono + Zod + jose + aws4fetch + Drizzle (D1) + R2, run under `wrangler dev`.
import { Hono } from "hono";
import { z } from "zod";
import { SignJWT, jwtVerify } from "jose";
import { AwsClient } from "aws4fetch";
import { drizzle } from "drizzle-orm/d1";
import { asc } from "drizzle-orm";
import { notesSqlite } from "./schema";

// Structural binding types, no @cloudflare/workers-types (app lib set = ES + Web APIs).
interface D1Like { prepare(q: string): { run(): Promise<unknown> } }
interface R2Like {
  put(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}
type Env = { DB: D1Like; FILES: R2Like };

const NoteIn = z.object({ id: z.string().min(1), title: z.string(), rank: z.number().int() });
const key = new TextEncoder().encode("spike-only-not-a-secret-0123456789abcdef");

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/notes", async (c) => {
  const parsed = NoteIn.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: z.treeifyError(parsed.error) }, 400);
  await c.env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS notes (id text PRIMARY KEY NOT NULL, title text NOT NULL, rank integer NOT NULL, body text)",
  ).run();
  // drizzle's D1 driver expects the real D1Database; the structural type is enough at runtime.
  const db = drizzle(c.env.DB as never);
  await db.insert(notesSqlite).values(parsed.data).onConflictDoNothing();
  const rows = await db.select().from(notesSqlite).orderBy(asc(notesSqlite.title));
  return c.json({ rows });
});

app.get("/api/r2", async (c) => {
  await c.env.FILES.put("a/b.txt", "hello-r2");
  const obj = await c.env.FILES.get("a/b.txt");
  return c.json({ text: obj ? await obj.text() : null });
});

app.get("/api/jwt", async (c) => {
  const jwt = await new SignJWT({ sub: "u1" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(key);
  const { payload } = await jwtVerify(jwt, key);
  return c.json({ sub: payload.sub });
});

app.get("/api/sigv4", async (c) => {
  const aws = new AwsClient({ accessKeyId: "AKIDSPIKE", secretAccessKey: "spike-not-secret", service: "s3", region: "auto" });
  const signed = await aws.sign("https://example.r2.cloudflarestorage.com/bucket/key", { method: "GET" });
  const auth = signed.headers.get("authorization") ?? "";
  return c.json({ signed: auth.startsWith("AWS4-HMAC-SHA256 Credential=AKIDSPIKE/") });
});

export default app;
