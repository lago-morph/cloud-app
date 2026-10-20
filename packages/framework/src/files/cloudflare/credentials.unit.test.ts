import { describe, expect, it } from "vitest";
import { s3CredentialsFromToken } from "./credentials.js";

describe("S3 credentials of an R2 API token (DEC-0100)", () => {
  it("access key ID = token id; secret access key = lowercase hex SHA-256 of the token value", async () => {
    // "abc" is the FIPS 180-2 SHA-256 example input, not a token.
    expect(await s3CredentialsFromToken({ id: "token-id-1", value: "abc" })).toEqual({
      accessKeyId: "token-id-1",
      secretAccessKey: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
  });
});
