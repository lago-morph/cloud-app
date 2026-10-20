import { describe, expect, it } from "vitest";
import { downloadDisposition } from "./disposition.js";

describe("download Content-Disposition (DEC-0313, FILES-REQ-003)", () => {
  it("names the file with filename*=UTF-8'' and serves non-images as attachments", () => {
    expect(downloadDisposition("report.pdf", "application/pdf")).toBe("attachment; filename*=UTF-8''report.pdf");
  });

  it("percent-encodes everything outside RFC 8187 attr-char, including ' ( ) * and the whole name with its slashes", () => {
    expect(downloadDisposition("a/b c'(1)*ä%;\".txt", "text/plain")).toBe(
      "attachment; filename*=UTF-8''a%2Fb%20c%27%281%29%2A%C3%A4%25%3B%22.txt",
    );
    // attr-char punctuation stays as it is.
    expect(downloadDisposition("!#$&+-.^_`|~", "text/plain")).toBe("attachment; filename*=UTF-8''!#$&+-.^_`|~");
  });

  it.each(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "IMAGE/PNG", "image/png; x=y"])(
    "raster image type %s is inline",
    (contentType) => {
      expect(downloadDisposition("p.png", contentType)).toBe("inline; filename*=UTF-8''p.png");
    },
  );

  it.each(["text/html", "image/svg+xml", "application/octet-stream", ""])("type %j is an attachment", (contentType) => {
    expect(downloadDisposition("p", contentType)).toBe("attachment; filename*=UTF-8''p");
  });
});
