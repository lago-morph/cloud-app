import { describe, expect, it } from "vitest";
import { emailDomainProblem, testMailDomain } from "./account-settings.js";

describe("the account's email domain and what derives from it (MAIL-REQ-003, DEC-0511, DEC-0514)", () => {
  it("the test mailbox subdomain is t.<emailDomain>", () => {
    expect(testMailDomain("example.test")).toBe("t.example.test");
  });

  it.each(["example.test", "mail.example.test", "a-b.example", "x1.invalid", "xn--bcher-kva.example"])("accepts the domain %s", (domain) => {
    expect(emailDomainProblem(domain)).toBeUndefined();
  });

  it.each(["", "example", ".example.test", "example.test.", "a..test", "-a.test", "a-.test", "a_b.test", "a b.test", "Example.test", "1.2.3.4", "no-reply@example.test", `${"a".repeat(64)}.test`])(
    "refuses %j",
    (domain) => {
      expect(emailDomainProblem(domain)).toMatch(/not a domain name/);
    },
  );

  it("refuses a domain whose test mailbox subdomain would be longer than a domain name may be", () => {
    const label = "a".repeat(61);
    const domain = `${label}.${label}.${label}.${label}.test`;
    expect(domain.length).toBeLessThanOrEqual(253);
    expect(testMailDomain(domain).length).toBeGreaterThan(253);
    expect(emailDomainProblem(domain)).toMatch(/too long/);
  });
});
