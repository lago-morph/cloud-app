import { describe, expect, it } from "vitest";
import { downloadDisposition } from "./disposition.js";

describe("download Content-Disposition (DEC-0313, FILES-REQ-003)", () => {
  it("names the file with filename*=UTF-8'' and serves it as an attachment", () => {
    expect(downloadDisposition("report.pdf")).toBe("attachment; filename*=UTF-8''report.pdf");
  });

  it("percent-encodes everything outside RFC 8187 attr-char, including ' ( ) * and the whole name with its slashes", () => {
    expect(downloadDisposition("a/b c'(1)*ä%;\".txt")).toBe(
      "attachment; filename*=UTF-8''a%2Fb%20c%27%281%29%2A%C3%A4%25%3B%22.txt",
    );
    // attr-char punctuation stays as it is.
    expect(downloadDisposition("!#$&+-.^_`|~")).toBe("attachment; filename*=UTF-8''!#$&+-.^_`|~");
  });

  it.each(["p.png", "p.jpg", "p.gif", "p.webp", "p.avif", "p.bmp", "p.svg", "p.html", "p"])("%j, a raster image or not, is an attachment (DEC-PENDING-fix-f04b-1)", (name) => {
    expect(downloadDisposition(name)).toBe(`attachment; filename*=UTF-8''${name}`);
  });
});
