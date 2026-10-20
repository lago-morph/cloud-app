# Example: declaring and reading a secret

Every file below is copied unchanged from the framework's app template (`apps/template`) or its compliance reference app (`apps/reference`). The framework's CI type-checks and tests those apps (`npm run verify` runs each app's `verify`), so this code compiles and passes as shown. Do not copy code from any other app.

What it shows:

- `env.ts`: the secret name `apiKey` is declared in `secrets`.
- `routes/admin.ts`: `await c.var.secrets.get("apiKey")`; the route reports only whether it is set, never the value.
- From the reference app, `encoding.ts`: Web-API-only byte helpers (`crypto.subtle.digest`, `btoa`/`atob`, `TextEncoder`), with no `Buffer`.

## `apps/template/src/server/env.ts`

<!-- example-source: apps/template/src/server/env.ts -->
```ts
import { configString, type AppEnv } from "@lago-morph/prototype-framework";

/** Non-secret configuration keys; values per stage are in `config/`. */
export const config = {
  greeting: configString({ default: "Hello" }),
};

/** Secret names; values are set with `secrets set <name>`, never committed. */
export const secrets = ["apiKey"] as const;

/** The Hono environment every route module takes: `Hono<Env>`. */
export type Env = AppEnv<typeof config, (typeof secrets)[number]>;
```

## `apps/template/src/server/routes/admin.ts`

<!-- example-source: apps/template/src/server/routes/admin.ts -->
```ts
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
```

## `apps/reference/src/server/encoding.ts`

<!-- example-source: apps/reference/src/server/encoding.ts -->
```ts
/** Byte helpers shared by the routes (Web APIs only). */

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

/** Lowercase hex SHA-256 of bytes or of a string's UTF-8 encoding. */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Reads a stream to its end. */
export async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
```
