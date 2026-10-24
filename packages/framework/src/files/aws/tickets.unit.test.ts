import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installAwsNetworkGuard, type AwsNetworkGuard } from "../../provision/aws/aws-network-guard.test-support.js";
import { createFilesService } from "../service.js";
import { expectedSignature } from "../s3/sigv4-reference.test-support.js";
import { readDownloadTicket, readUploadTicket } from "../tickets.js";
import { lambdaSessionCredentials } from "./location.js";
import { createS3Fake } from "./s3-fake.test-support.js";
import { createS3FilesStore } from "./store.js";
import { createAwsTicketIssuer, type AwsTicketOptions } from "./tickets.js";

let guard: AwsNetworkGuard;
beforeAll(() => {
  guard = installAwsNetworkGuard();
});
afterAll(() => {
  expect(guard.attempts).toEqual([]);
  guard.uninstall();
});

const location = { bucket: "app-test-x-files", region: "us-east-1", accountId: "123456789012" };
const NOW = Date.parse("2026-10-24T10:00:00.000Z");
const LIFETIME = 15 * 60 * 1000;

/**
 * Fixed vector inputs: the S3 documentation's example key pair (never a real credential) and a
 * made-up session token.
 */
const FIXED = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  sessionToken: "FwoGZXIvYXdzEXAMPLE//session+token=",
};

/** Generated per run: dummy session credentials. */
const dummy = { accessKeyId: `ASIA${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`, secretAccessKey: crypto.randomUUID(), sessionToken: crypto.randomUUID() };

function issuer(overrides: Partial<AwsTicketOptions> = {}) {
  return createAwsTicketIssuer({ location, credentials: () => dummy, now: () => NOW, ...overrides });
}

describe("AWS ticket signing on fixed vectors (files.md §2 AWS, DEC-0062)", () => {
  it("upload: the exact presigned PUT URL, session token and content type signed", async () => {
    const tickets = issuer({ credentials: () => FIXED });
    const ticket = readUploadTicket(await tickets.upload("photos/ä b.png", "image/png"));
    expect(ticket).toEqual({
      url:
        "https://app-test-x-files.s3.us-east-1.amazonaws.com/photos/%C3%A4%20b.png" +
        "?X-Amz-Expires=900&X-Amz-Date=20261024T100000Z" +
        "&X-Amz-Security-Token=FwoGZXIvYXdzEXAMPLE%2F%2Fsession%2Btoken%3D" +
        "&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20261024%2Fus-east-1%2Fs3%2Faws4_request" +
        "&X-Amz-SignedHeaders=content-type%3Bhost" +
        "&X-Amz-Signature=ddd88666923a09f1ed271830f09e5ea586d899cdf0fc34ceb9d52d36d8f875ef",
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      expiresAt: NOW + LIFETIME,
    });
    expect(new URL(ticket?.url ?? "").searchParams.get("X-Amz-Signature")).toBe(expectedSignature(ticket?.url ?? "", "PUT", { "Content-Type": "image/png" }, FIXED.secretAccessKey));
  });

  it("download: the exact presigned GET URL, session token and the attachment disposition signed (DEC-0414)", async () => {
    const tickets = issuer({ credentials: () => FIXED });
    const ticket = readDownloadTicket(await tickets.download("photos/ä b.png"));
    expect(ticket).toEqual({
      url:
        "https://app-test-x-files.s3.us-east-1.amazonaws.com/photos/%C3%A4%20b.png" +
        "?response-content-disposition=attachment%3B+filename*%3DUTF-8%27%27photos%252F%25C3%25A4%2520b.png" +
        "&X-Amz-Expires=900&X-Amz-Date=20261024T100000Z" +
        "&X-Amz-Security-Token=FwoGZXIvYXdzEXAMPLE%2F%2Fsession%2Btoken%3D" +
        "&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20261024%2Fus-east-1%2Fs3%2Faws4_request" +
        "&X-Amz-SignedHeaders=host" +
        "&X-Amz-Signature=c10990fde3d64c7f3e98b39706560bb04fc804da9f13f8afee84833c7d977269",
      expiresAt: NOW + LIFETIME,
    });
    expect(new URL(ticket?.url ?? "").searchParams.get("X-Amz-Signature")).toBe(expectedSignature(ticket?.url ?? "", "GET", {}, FIXED.secretAccessKey));
  });
});

describe("AWS upload tickets (FILES-REQ-003)", () => {
  it("is the shared JSON shape with a virtual-hosted S3 URL; carries key ID, signature and session token, never the secret", async () => {
    const ticket = readUploadTicket(await issuer().upload("a.txt", "text/plain"));
    const url = new URL(ticket?.url ?? "");
    expect(url.origin).toBe("https://app-test-x-files.s3.us-east-1.amazonaws.com");
    expect(url.pathname).toBe("/a.txt");
    expect(url.searchParams.get("X-Amz-Credential")).toBe(`${dummy.accessKeyId}/20261024/us-east-1/s3/aws4_request`);
    expect(url.searchParams.get("X-Amz-Security-Token")).toBe(dummy.sessionToken);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(ticket?.url).not.toContain(dummy.secretAccessKey);
  });

  it("names with dot segments use %2F; a name that is only . or .. gets no ticket (DEC-0328)", async () => {
    expect(new URL(readUploadTicket(await issuer().upload("x/../y", "text/plain"))?.url ?? "").pathname).toBe("/x%2F..%2Fy");
    await expect(issuer().upload("..", "text/plain")).rejects.toMatchObject({ code: "FILES.INVALID_NAME" });
    await expect(issuer().download(".")).rejects.toMatchObject({ code: "FILES.INVALID_NAME" });
  });

  it("reads the credentials for each ticket", async () => {
    let reads = 0;
    const counting = issuer({ credentials: () => (reads++, dummy) });
    await counting.upload("a", "text/plain");
    await counting.download("a");
    expect(reads).toBe(2);
  });
});

describe("[FILES-AC-003 pre-check] tickets against the S3 fake: scope, content type, expiry", () => {
  function world(at: { now: number }) {
    const fake = createS3Fake({ location, credentials: dummy, now: () => at.now });
    const tickets = issuer();
    const files = createFilesService({ store: createS3FilesStore({ location, credentials: () => dummy, fetch: fake.fetch, now: () => at.now }), tickets });
    return { fake, tickets, files };
  }
  const put = (fake: ReturnType<typeof createS3Fake>, url: string, contentType: string, body = "data") =>
    fake.fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body });

  it("an upload ticket stores the body; a download ticket returns it as a named attachment", async () => {
    const at = { now: NOW };
    const { fake, files } = world(at);
    const upload = readUploadTicket(await files.createUploadTicket("in/photo.png", { contentType: "image/png" }));
    const uploaded = await put(fake, upload?.url ?? "", "image/png", "PNGDATA");
    expect(uploaded.status).toBe(200);
    expect(await files.head("in/photo.png")).toEqual({ name: "in/photo.png", size: 7, contentType: "image/png" });
    const download = readDownloadTicket(await files.createDownloadTicket("in/photo.png"));
    const got = await fake.fetch(download?.url ?? "");
    expect(got.status).toBe(200);
    expect(await got.text()).toBe("PNGDATA");
    expect(got.headers.get("Content-Disposition")).toBe("attachment; filename*=UTF-8''in%2Fphoto.png");
  });

  it("another content type, another name, another method, or no session token is refused", async () => {
    const { fake, tickets } = world({ now: NOW });
    const upload = readUploadTicket(await tickets.upload("mine.txt", "text/plain"));
    const url = upload?.url ?? "";
    expect((await put(fake, url, "text/html")).status).toBe(403);
    expect((await put(fake, url.replace("/mine.txt", "/theirs.txt"), "text/plain")).status).toBe(403);
    expect((await fake.fetch(url)).status).toBe(403);
    const noToken = new URL(url);
    noToken.searchParams.delete("X-Amz-Security-Token");
    expect((await put(fake, noToken.href, "text/plain")).status).toBe(400);
    expect(fake.objects.size).toBe(0);
    expect((await put(fake, url, "text/plain")).status).toBe(200);
  });

  it("works repeatedly until PAR-233 has passed, then S3 refuses it (403)", async () => {
    const at = { now: NOW };
    const { fake, tickets } = world(at);
    const upload = readUploadTicket(await tickets.upload("t.txt", "text/plain"));
    const download = readDownloadTicket(await tickets.download("t.txt"));
    expect(upload?.expiresAt).toBe(NOW + LIFETIME);
    expect((await put(fake, upload?.url ?? "", "text/plain")).status).toBe(200);
    at.now = NOW + LIFETIME;
    expect((await put(fake, upload?.url ?? "", "text/plain", "again")).status).toBe(200);
    expect((await fake.fetch(download?.url ?? "")).status).toBe(200);
    at.now = NOW + LIFETIME + 1000;
    const expired = await put(fake, upload?.url ?? "", "text/plain");
    expect(expired.status).toBe(403);
    expect((await fake.fetch(download?.url ?? "")).status).toBe(403);
    expect(new TextDecoder().decode(fake.objects.get("t.txt")?.bytes)).toBe("again");
  });

  it("unsigned requests to the bucket are refused (FILES-REQ-005)", async () => {
    const { fake } = world({ now: NOW });
    fake.objects.set("p", { bytes: new Uint8Array([1]), contentType: "text/plain" });
    expect((await fake.fetch("https://app-test-x-files.s3.us-east-1.amazonaws.com/p")).status).toBe(403);
    expect((await put(fake, "https://app-test-x-files.s3.us-east-1.amazonaws.com/p", "text/plain")).status).toBe(403);
  });
});

describe("the Lambda role's session credentials", () => {
  it("come from the Lambda environment, session token included", () => {
    expect(lambdaSessionCredentials({ AWS_ACCESS_KEY_ID: "ASIAX", AWS_SECRET_ACCESS_KEY: "s", AWS_SESSION_TOKEN: "t" })).toEqual({ accessKeyId: "ASIAX", secretAccessKey: "s", sessionToken: "t" });
  });

  it("missing ones are CORE.MISCONFIGURED naming the variables, never their values", () => {
    expect(() => lambdaSessionCredentials({ AWS_ACCESS_KEY_ID: "ASIAX", AWS_SECRET_ACCESS_KEY: "hidden" })).toThrow(
      expect.objectContaining({ code: "CORE.MISCONFIGURED", message: expect.stringMatching(/AWS_SESSION_TOKEN/) }),
    );
    try {
      lambdaSessionCredentials({ AWS_SECRET_ACCESS_KEY: "hidden" });
    } catch (thrown) {
      expect(String((thrown as Error).message)).not.toContain("hidden");
    }
  });
});
