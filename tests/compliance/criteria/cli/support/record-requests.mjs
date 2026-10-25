// Preloaded into a CLI process under test (`node --import=<this file>`) by the CLI-AC-007 test
// (docs/components/cli.md §4): it records every outgoing HTTP request the process starts, so
// the test can show that a refused `admins` run sent no request to the D1 API ("a recorded
// fetch shows none"). One line per request, `<channel> <url>`, appended to the file named by
// COMPLIANCE_REQUEST_LOG; the first line, `started`, shows that the preload ran. Only URLs are
// written: no header, body or credential.
import { subscribe } from "node:diagnostics_channel";
import { appendFileSync } from "node:fs";

const file = process.env.COMPLIANCE_REQUEST_LOG;

if (file !== undefined && file !== "") {
  const log = (line) => {
    try {
      appendFileSync(file, `${line}\n`);
    } catch {
      // the test reads what was written
    }
  };
  log("started");
  const original = globalThis.fetch;
  if (typeof original === "function") {
    globalThis.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url ?? "");
      log(`fetch ${url}`);
      return original(input, init);
    };
  }
  subscribe("undici:request:create", (message) => {
    const r = message?.request;
    log(`undici ${String(r?.origin ?? "")}${String(r?.path ?? "")}`);
  });
  subscribe("http.client.request.start", (message) => {
    const r = message?.request;
    log(`http ${String(r?.protocol ?? "")}//${String(r?.host ?? "")}${String(r?.path ?? "")}`);
  });
}
