import { describe, expect, it } from "vitest";
import { downloadDisposition, inlineImageType } from "./disposition.js";

describe("download Content-Disposition (DEC-0313, DEC-0535, FILES-REQ-003)", () => {
  it("names the file with filename*=UTF-8'' and serves it as an attachment", () => {
    expect(downloadDisposition("report.pdf", "application/pdf")).toBe("attachment; filename*=UTF-8''report.pdf");
    expect(downloadDisposition("report.pdf")).toBe("attachment; filename*=UTF-8''report.pdf");
  });

  it("percent-encodes everything outside RFC 8187 attr-char, including ' ( ) * and the whole name with its slashes", () => {
    expect(downloadDisposition("a/b c'(1)*ä%;\".txt")).toBe(
      "attachment; filename*=UTF-8''a%2Fb%20c%27%281%29%2A%C3%A4%25%3B%22.txt",
    );
    // attr-char punctuation stays as it is.
    expect(downloadDisposition("!#$&+-.^_`|~")).toBe("attachment; filename*=UTF-8''!#$&+-.^_`|~");
  });

  it.each(["image/png", "image/jpeg", "image/gif", "image/webp", "IMAGE/PNG", "image/jpeg; charset=binary"])("%j is served inline, keeping the real filename (DEC-0535)", (type) => {
    expect(downloadDisposition("photos/ä b.png", type)).toBe("inline; filename*=UTF-8''photos%2F%C3%A4%20b.png");
  });

  it.each(["image/svg+xml", "text/html", "application/xhtml+xml", "image/avif", "image/bmp", "image/x-icon", "image/pngx", "text/plain", "application/octet-stream", ""])(
    "%j stays an attachment (DEC-0535)",
    (type) => {
      expect(downloadDisposition("p.png", type)).toBe("attachment; filename*=UTF-8''p.png");
    },
  );

  it("the inline type is the essence of the stored type, lowercased", () => {
    expect(inlineImageType(" Image/WebP ; q=1")).toBe("image/webp");
    expect(inlineImageType("image/svg+xml")).toBeUndefined();
    expect(inlineImageType(undefined)).toBeUndefined();
  });
});
