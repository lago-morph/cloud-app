// Usage: node fetch.mjs <url>  — prints status, content-type and body (or the error chain).
const url = process.argv[2];
const t0 = Date.now();
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  console.log(`status=${res.status} content-type=${res.headers.get("content-type")} ms=${Date.now() - t0}`);
  console.log(`body=${(await res.text()).slice(0, 200)}`);
} catch (err) {
  console.log(`error after ms=${Date.now() - t0}: ${err.name}: ${err.message}`);
  let c = err.cause;
  while (c) {
    console.log(`  cause: ${c.code ?? ""} ${c.message ?? c}`);
    c = c.cause;
  }
  process.exitCode = 1;
}
