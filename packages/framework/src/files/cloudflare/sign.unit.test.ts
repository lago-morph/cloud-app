import { describe, expect, it } from "vitest";
import { presignUrl } from "./sign.js";
import { expectedSignature } from "./sigv4-reference.test-support.js";

/**
 * The published SigV4 query-signing example ("Authenticating Requests: Using Query Parameters",
 * Amazon S3 API reference): documentation example credentials, never a real key.
 */
const EXAMPLE = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};
const EXAMPLE_SIGNATURE = "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404";

/** Generated per run: a dummy key pair, never a real credential. */
const dummy = { accessKeyId: crypto.randomUUID().replaceAll("-", ""), secretAccessKey: crypto.randomUUID() };

describe("SigV4 query signing (DEC-0098)", () => {
  it("reproduces the published presigned GET example exactly", async () => {
    const url = await presignUrl({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      region: "us-east-1",
      credentials: EXAMPLE,
      expiresInSeconds: 86400,
      now: new Date("2013-05-24T00:00:00Z"),
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://examplebucket.s3.amazonaws.com/test.txt");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": "AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request",
      "X-Amz-Date": "20130524T000000Z",
      "X-Amz-Expires": "86400",
      "X-Amz-SignedHeaders": "host",
      "X-Amz-Signature": EXAMPLE_SIGNATURE,
    });
    // The test's own reference agrees with the published vector, so it can judge other URLs.
    expect(expectedSignature(url, "GET", {}, EXAMPLE.secretAccessKey)).toBe(EXAMPLE_SIGNATURE);
  });

  it("signs Content-Type of a PUT (SignedHeaders content-type;host) and the URL's own query parameters", async () => {
    const headers = { "Content-Type": "image/png" };
    const url = await presignUrl({
      method: "PUT",
      url: "https://acct.r2.cloudflarestorage.com/bucket/a/b%20c.png?response-content-disposition=x%3By",
      headers,
      region: "auto",
      credentials: dummy,
      expiresInSeconds: 900,
      now: new Date("2026-10-20T01:02:03.456Z"),
    });
    const params = new URL(url).searchParams;
    expect(params.get("X-Amz-SignedHeaders")).toBe("content-type;host");
    expect(params.get("X-Amz-Credential")).toBe(`${dummy.accessKeyId}/20261020/auto/s3/aws4_request`);
    expect(params.get("X-Amz-Date")).toBe("20261020T010203Z");
    expect(params.get("X-Amz-Expires")).toBe("900");
    expect(params.get("response-content-disposition")).toBe("x;y");
    expect(url).not.toContain(dummy.secretAccessKey);
    expect(params.get("X-Amz-Signature")).toBe(expectedSignature(url, "PUT", headers, dummy.secretAccessKey));
    // A different content type does not carry the signature (what storage refuses, A-07 N2).
    expect(params.get("X-Amz-Signature")).not.toBe(expectedSignature(url, "PUT", { "Content-Type": "text/html" }, dummy.secretAccessKey));
  });
});
