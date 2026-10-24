#!/usr/bin/env node
// Package binary (CLI-REQ-001): `npx @lago-morph/prototype-framework <command>`.
// Runs the compiled CLI from dist/ (built by `npm run build` in this package).
const { main } = await import("../dist/cli/public.js");
process.exitCode = await main(process.argv.slice(2));
