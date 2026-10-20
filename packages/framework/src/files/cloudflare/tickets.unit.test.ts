import { describe, expect, it } from "vitest";
import { readDownloadTicket, readUploadTicket } from "../tickets.js";
import { expectedSignature } from "./sigv4-reference.test-support.js";
import { createCloudflareTicketIssuer, createWorkerTicketIssuer, type CloudflareTicketOptions } from "./tickets.js";

/** Generated per run: dummy identifiers and key pair, never real ones. */
const accountId = crypto.randomUUID().replaceAll("-", "");
const credentials = { accessKeyId: crypto.randomUUID().replaceAll("-", ""), secretAccessKey: crypto.randomUUID() };
const NOW = Date.parse("2026-10-20T01:02:03.000Z");

function issuer(overrides: Partial<CloudflareTicketOptions> = {}) {
  return createCloudflareTicketIssuer({ accountId, bucket: "app-test-x-files", credentials: async () => credentials, now: () => NOW, ...overrides });
}

describe("Cloudflare upload tickets (DEC-0098, DEC-0160, FILES-REQ-003)", () => {
  it("is the shared JSON shape: a path-style R2 S3 URL, PUT, the Content-Type header and expiresAt = now + PAR-233", async () => {
    const ticket = readUploadTicket(await issuer().upload("photo.png", "image/png"));
    expect(ticket).toBeDefined();
    expect(ticket?.method).toBe("PUT");
    expect(ticket?.headers).toEqual({ "Content-Type": "image/png" });
    expect(ticket?.expiresAt).toBe(NOW + 15 * 60 * 1000);
    const url = new URL(ticket?.url ?? "");
    expect(url.origin).toBe(`https://${accountId}.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe("/app-test-x-files/photo.png");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
    expect(url.searchParams.get("X-Amz-Credential")).toBe(`${credentials.accessKeyId}/20261020/auto/s3/aws4_request`);
    expect(url.searchParams.get("X-Amz-Date")).toBe("20261020T010203Z");
    expect(ticket?.url).not.toContain(credentials.secretAccessKey);
  });

  it.each([
    ["tickets/ä ö %/photo 1.png", "/tickets/%C3%A4%20%C3%B6%20%25/photo%201.png"],
    ["it's (1)*!.txt", "/it%27s%20%281%29%2A%21.txt"],
    ["a?b#c&d=e+f", "/a%3Fb%23c%26d%3De%2Bf"],
    ["a//b/", "/a//b/"],
  ])("FILES-REQ-002: the name %j is the key, each /-segment RFC 3986-encoded", async (name, path) => {
    const ticket = readUploadTicket(await issuer().upload(name, "text/plain"));
    const url = new URL(ticket?.url ?? "");
    expect(url.pathname).toBe(`/app-test-x-files${path}`);
    expect(url.search.startsWith("?X-Amz-")).toBe(true);
    expect(url.searchParams.get("X-Amz-Signature")).toBe(expectedSignature(ticket?.url ?? "", "PUT", { "Content-Type": "text/plain" }, credentials.secretAccessKey));
  });

  it.each(["x/../y", "../up.txt", "./dot", "a/.", "a/b/.."])(
    "FILES-REQ-002: %j is never resolved as a path: its slashes are sent as %2F so no dot segment collapses",
    async (name) => {
      const ticket = readUploadTicket(await issuer().upload(name, "text/plain"));
      const url = new URL(ticket?.url ?? "");
      expect(url.pathname).toBe(`/app-test-x-files/${encodeURIComponent(name)}`);
      expect(decodeURIComponent(url.pathname.slice("/app-test-x-files/".length))).toBe(name);
      expect(url.searchParams.get("X-Amz-Signature")).toBe(expectedSignature(ticket?.url ?? "", "PUT", { "Content-Type": "text/plain" }, credentials.secretAccessKey));
    },
  );

  it.each([".", ".."])("the name %j cannot be a storage URL path, so no ticket is issued (FILES.INVALID_NAME)", async (name) => {
    await expect(issuer().upload(name, "text/plain")).rejects.toMatchObject({ code: "FILES.INVALID_NAME" });
    await expect(issuer().download(name)).rejects.toMatchObject({ code: "FILES.INVALID_NAME" });
  });

  it("reads the credentials for each ticket, so a rotated secret is used at once", async () => {
    let reads = 0;
    const counting = issuer({ credentials: async () => (reads++, credentials) });
    await counting.upload("a", "text/plain");
    await counting.upload("a", "text/plain");
    expect(reads).toBe(2);
  });
});

describe("the Worker's issuer reads the stage's R2 token from the framework-internal secrets (DEC-0100)", () => {
  it("signs with frameworkR2AccessKeyId / frameworkR2SecretAccessKey, read per ticket", async () => {
    const read: string[] = [];
    const secrets: Record<string, string> = { frameworkR2AccessKeyId: credentials.accessKeyId, frameworkR2SecretAccessKey: credentials.secretAccessKey };
    const tickets = createWorkerTicketIssuer({ accountId, bucket: "b" }, async (name) => (read.push(name), secrets[name] ?? ""));
    const ticket = readDownloadTicket(await tickets.download("x"));
    expect(new URL(ticket?.url ?? "").searchParams.get("X-Amz-Credential")?.startsWith(`${credentials.accessKeyId}/`)).toBe(true);
    expect(new URL(ticket?.url ?? "").searchParams.get("X-Amz-Signature")).toBe(expectedSignature(ticket?.url ?? "", "GET", {}, credentials.secretAccessKey));
    expect(read.sort()).toEqual(["frameworkR2AccessKeyId", "frameworkR2SecretAccessKey"]);
  });

  it("a missing secret's error reaches the caller unchanged", async () => {
    const missing = new Error("unset");
    const tickets = createWorkerTicketIssuer({ accountId, bucket: "b" }, async () => {
      throw missing;
    });
    await expect(tickets.upload("x", "text/plain")).rejects.toBe(missing);
  });
});

describe("Cloudflare download tickets (DEC-0098, DEC-0160, DEC-0313)", () => {
  it("is { url, expiresAt }: a GET URL signing host only, naming the file through response-content-disposition", async () => {
    const ticket = readDownloadTicket(await issuer().download("photos/ä b.pdf", "application/pdf"));
    expect(ticket).toBeDefined();
    expect(Object.keys(ticket ?? {}).sort()).toEqual(["expiresAt", "url"]);
    expect(ticket?.expiresAt).toBe(NOW + 15 * 60 * 1000);
    const url = new URL(ticket?.url ?? "");
    expect(url.pathname).toBe("/app-test-x-files/photos/%C3%A4%20b.pdf");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("response-content-disposition")).toBe("attachment; filename*=UTF-8''photos%2F%C3%A4%20b.pdf");
    expect(url.searchParams.get("X-Amz-Signature")).toBe(expectedSignature(ticket?.url ?? "", "GET", {}, credentials.secretAccessKey));
    expect(ticket?.url).not.toContain(credentials.secretAccessKey);
  });

  it("a raster image is named inline; without a known content type the download is an attachment", async () => {
    const image = new URL(readDownloadTicket(await issuer().download("p.png", "image/png"))?.url ?? "");
    expect(image.searchParams.get("response-content-disposition")).toBe("inline; filename*=UTF-8''p.png");
    const unknown = new URL(readDownloadTicket(await issuer().download("p.png"))?.url ?? "");
    expect(unknown.searchParams.get("response-content-disposition")).toBe("attachment; filename*=UTF-8''p.png");
  });
});
