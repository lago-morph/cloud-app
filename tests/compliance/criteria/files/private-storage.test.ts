/**
 * FILES-AC-005 (Where: Cloud): unsigned requests to the stage's storage are refused
 * (docs/components/files.md FILES-REQ-005: stored files are not publicly readable or writable
 * except through valid tickets).
 *
 * The test finds the stage's storage only the way a stranger could: from a ticket URL the app
 * handed out, with its signature (the query string, which carries it for signed URLs) removed.
 * It then tries an unsigned read of the file, an unsigned overwrite, an unsigned read of a
 * sibling name, and an unsigned listing of the storage root, and checks that each is refused
 * and that the file is unchanged.
 */
import { afterAll, describe, expect, it } from "vitest";
import { client, tag, USER_AGENT, type ComplianceClient } from "../../harness/index.js";
import { getFile, put, removeAll, uniquePrefix } from "./support.js";

let u: ComplianceClient | undefined;
const prefix = uniquePrefix("ac005");

afterAll(async () => {
  if (u !== undefined) await removeAll(u, prefix);
});

interface Ticket {
  readonly url: string;
}

async function attempt(url: URL, method: string, body?: Uint8Array<ArrayBuffer>): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    method,
    headers: { "user-agent": USER_AGENT, ...(body === undefined ? {} : { "content-type": "application/octet-stream" }) },
    ...(body === undefined ? {} : { body }),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, text: await res.text() };
}

describe("FILES-AC-005 private storage", () => {
  it(tag("FILES-AC-005", "unsigned reads, writes and listings of the stage's storage are refused"), async () => {
    u = await client().as("user", { id: "c-t3-files-ac005" });
    const name = `${prefix}secret.bin`;
    const content = new Uint8Array([0x63, 0x2d, 0x74, 0x33, 0x2d, 0x70, 0x72, 0x69, 0x76, 0x61, 0x74, 0x65]);
    await put(u, name, content, "application/octet-stream");

    const download = u.expectStatus(await u.post("/api/files/download-ticket", { name }), 200).json<{ ticket: Ticket }>().ticket;
    const upload = u.expectStatus(await u.post("/api/files/upload-ticket", { name, contentType: "application/octet-stream" }), 200).json<{ ticket: Ticket }>().ticket;
    for (const t of [download, upload]) expect(typeof t.url).toBe("string");

    const signedRead = new URL(download.url, u.baseUrl);
    const unsigned = new URL(signedRead.pathname, signedRead.origin);
    const sibling = new URL(unsigned.pathname.replace(/[^/]*$/, "other-name"), unsigned.origin);
    const root = new URL("/", unsigned.origin);
    const bucketRoot = new URL(unsigned.pathname.split("/").slice(0, 2).join("/") + "/", unsigned.origin);

    // The refusals must not be the file: no 2xx, and the body never contains its bytes.
    const secretText = new TextDecoder().decode(content);
    for (const [label, url] of [["unsigned read", unsigned], ["unsigned read of another name", sibling], ["unsigned listing of the storage root", root], ["unsigned listing of the bucket", bucketRoot]] as const) {
      const r = await attempt(url, "GET");
      expect(r.status >= 400 && r.status < 500, `${label}: status ${String(r.status)}`).toBe(true);
      expect(r.text.includes(secretText), `${label}: body leaks the file`).toBe(false);
      expect(r.text.includes(name), `${label}: body leaks the file name`).toBe(false);
    }
    const overwrite = await attempt(new URL(new URL(upload.url, u.baseUrl).pathname, unsigned.origin), "PUT", new Uint8Array([0x6f, 0x77, 0x6e, 0x65, 0x64]));
    expect(overwrite.status >= 400 && overwrite.status < 500, `unsigned overwrite: status ${String(overwrite.status)}`).toBe(true);

    const after = await getFile(u, name);
    expect(Array.from(after?.bytes ?? [])).toStrictEqual(Array.from(content));
  });
});
