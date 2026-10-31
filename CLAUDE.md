# Agent instructions

- The authoritative specification and design documents are under `docs/`. Don't read them up front. When a task needs the spec, use `docs/README.md` only as an index to find the specific documents that task needs, and read only those.
- Commit and push to the feature branch frequently. Cloud sandboxes are ephemeral; work held only in a sandbox can be lost.
- **Hard rule: never read anything under `retrospective/`**, so that none of it enters your context. The only exception is the self-retrospective skill while it runs: it may read earlier retrospectives. Never use, in any decision, a retrospective recommendation that the owner has not adopted.
- **The main agent of every session orchestrates.** It keeps its context small, and it cuts wall-clock time by making aggressive use of subagents.
  - It briefs subagents, tracks items, merges branches, and relays questions to the owner. It plans nothing, writes no code, tests or documents, runs no suites, and diagnoses nothing.
  - A brief gives file paths, not file contents. Subagents return short summaries and put the details in files in the repository.
  - Independent items run in parallel, each in its own worktree and branch, when they don't touch the same files and that saves wall-clock time. Bounded research is delegated, and only its conclusions come back.
- For any change to code or tests, follow the testing-standards skill: `.claude/skills/testing-standards/SKILL.md`.
