/**
 * Lambda Function URL events (payload format 2.0), shaped as AWS documents them for Function
 * URLs: routeKey "$default", accountId "anonymous" (auth type NONE), cookies split out of the
 * headers. Fixture data only; nothing here is ever sent anywhere.
 */
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const base = {
  version: "2.0",
  routeKey: "$default",
  rawQueryString: "",
  headers: {
    host: "abcdefghijklmnopqrstuvwxyz012345.lambda-url.us-east-1.on.aws",
    "user-agent": "spike",
    "x-forwarded-proto": "https",
    "x-forwarded-for": "203.0.113.7",
  },
  isBase64Encoded: false,
} as const;

function context(method: string, path: string): APIGatewayProxyEventV2["requestContext"] {
  return {
    accountId: "anonymous",
    apiId: "abcdefghijklmnopqrstuvwxyz012345",
    domainName: "abcdefghijklmnopqrstuvwxyz012345.lambda-url.us-east-1.on.aws",
    domainPrefix: "abcdefghijklmnopqrstuvwxyz012345",
    http: { method, path, protocol: "HTTP/1.1", sourceIp: "203.0.113.7", userAgent: "spike" },
    requestId: "c6af9ac6-7b61-11e6-9a41-93e8deadbeef",
    routeKey: "$default",
    stage: "$default",
    time: "24/Oct/2026:12:00:00 +0000",
    timeEpoch: 1792843200000,
  };
}

/** GET /api/login?next=%2Fnotes with two request cookies. */
export const getWithCookies: APIGatewayProxyEventV2 = {
  ...base,
  rawPath: "/api/login",
  rawQueryString: "next=%2Fnotes",
  queryStringParameters: { next: "/notes" },
  cookies: ["a=1", "b=two"],
  requestContext: context("GET", "/api/login"),
};

/** POST /api/echo with a JSON body. */
export const postJson: APIGatewayProxyEventV2 = {
  ...base,
  headers: { ...base.headers, "content-type": "application/json" },
  rawPath: "/api/echo",
  body: JSON.stringify({ hello: "world" }),
  requestContext: context("POST", "/api/echo"),
};

/** POST /api/echo with a base64-encoded body (how Function URLs send non-text bodies). */
export const postBase64: APIGatewayProxyEventV2 = {
  ...base,
  headers: { ...base.headers, "content-type": "application/json" },
  rawPath: "/api/echo",
  body: Buffer.from(JSON.stringify({ b: 64 })).toString("base64"),
  isBase64Encoded: true,
  requestContext: context("POST", "/api/echo"),
};

/** GET of an unknown API path. */
export const unknownPath: APIGatewayProxyEventV2 = {
  ...base,
  rawPath: "/api/nope",
  requestContext: context("GET", "/api/nope"),
};
