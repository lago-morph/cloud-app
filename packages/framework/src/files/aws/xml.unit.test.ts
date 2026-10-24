import { describe, expect, it } from "vitest";
import { errorCode, parseListObjectsV2, S3XmlError, xmlText } from "./xml.js";

const result = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>b</Name>${body}</ListBucketResult>`;

describe("ListObjectsV2 XML", () => {
  it("reads keys, sizes and truncation; url-encoded keys are decoded (space as +, + as %2B)", () => {
    const xml = result(
      "<EncodingType>url</EncodingType><IsTruncated>true</IsTruncated>" +
        "<Contents><Key>a+b%2Bc/%C3%A4</Key><Size>3</Size><ETag>&quot;e&quot;</ETag></Contents>" +
        "<Contents><Key>%EF%BF%BF</Key><Size>0</Size></Contents>",
    );
    expect(parseListObjectsV2(xml)).toEqual({ objects: [{ key: "a b+c/ä", size: 3 }, { key: "￿", size: 0 }], truncated: true });
  });

  it("without EncodingType, keys are XML text (entity and character references resolved)", () => {
    const xml = result("<IsTruncated>false</IsTruncated><Contents><Key>a &amp; b &lt;c&gt; &#233;&#x1F600;</Key><Size>1</Size></Contents>");
    expect(parseListObjectsV2(xml)).toEqual({ objects: [{ key: "a & b <c> é😀", size: 1 }], truncated: false });
  });

  it("an empty listing has no objects", () => {
    expect(parseListObjectsV2(result("<KeyCount>0</KeyCount><IsTruncated>false</IsTruncated>"))).toEqual({ objects: [], truncated: false });
  });

  it.each([
    ["not a listing", "<Error><Code>AccessDenied</Code></Error>"],
    ["no IsTruncated", result("<Contents><Key>a</Key><Size>1</Size></Contents>")],
    ["an entry without a size", result("<IsTruncated>false</IsTruncated><Contents><Key>a</Key></Contents>")],
  ])("%s is an S3XmlError", (_label, xml) => {
    expect(() => parseListObjectsV2(xml)).toThrow(S3XmlError);
  });
});

describe("S3 error XML", () => {
  it("reads the code; anything else has none", () => {
    expect(errorCode("<?xml version=\"1.0\"?><Error><Code>NoSuchKey</Code><Message>m</Message></Error>")).toBe("NoSuchKey");
    expect(errorCode("")).toBeUndefined();
    expect(errorCode("<html/>")).toBeUndefined();
  });

  it("leaves unknown entities as they are", () => {
    expect(xmlText("&nbsp;&amp;")).toBe("&nbsp;&");
  });
});
