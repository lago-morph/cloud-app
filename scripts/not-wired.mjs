// Placeholder for a root script that a later plan item wires (ai/implementation/plan.md).
// It fails instead of reporting a pass for work that does not exist yet.
const [script = "script", owner = "a later item"] = process.argv.slice(2);
process.stderr.write(`npm run ${script}: not wired yet (wired by ${owner}).\n`);
process.exit(1);
