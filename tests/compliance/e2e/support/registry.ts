/**
 * A local npm registry for one scope (E2E-019, DEC-0767): it serves `@lago-morph/prototype-framework`
 * releases from local tarballs, so `npm view` and `npm install` of an unpublished version work as they
 * will once it is published. An app points the scope at it with `.npmrc`
 * (`@lago-morph:registry=<url>`); every other package still comes from the public registry.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { basename } from "node:path";

export interface LocalRegistry {
  readonly url: string;
  close(): Promise<void>;
}

/** The package.json inside a tarball. */
function manifestOf(tarball: string): Record<string, unknown> {
  // Synchronous: tar reads no standard input, which `run` would write to (EPIPE).
  return JSON.parse(execFileSync("tar", ["xzOf", tarball, "package/package.json"], { encoding: "utf8" })) as Record<string, unknown>;
}

export async function startLocalRegistry(tarballs: readonly string[]): Promise<LocalRegistry> {
  const files = new Map<string, Buffer>();
  const versions: Record<string, Record<string, unknown>> = {};
  let name = "";
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    if (path === `/${name}`) {
      res.writeHead(200, { "content-type": "application/json" });
      const latest = Object.keys(versions).at(-1) ?? "";
      return res.end(JSON.stringify({ name, "dist-tags": { latest }, versions }));
    }
    const file = files.get(basename(path));
    if (path.startsWith("/-/") && file !== undefined) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(file);
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/`;
  for (const tarball of tarballs) {
    const bytes = readFileSync(tarball);
    const manifest = manifestOf(tarball);
    name = String(manifest.name);
    const version = String(manifest.version);
    files.set(basename(tarball), bytes);
    versions[version] = {
      ...manifest,
      _id: `${name}@${version}`,
      dist: {
        tarball: `${url}-/${basename(tarball)}`,
        shasum: createHash("sha1").update(bytes).digest("hex"),
        integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
      },
    };
  }
  return { url, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
