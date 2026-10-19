# SKILL — AI skill and app template

Guidance for AI agents that build apps on the framework, plus the app template and a scaffolder. The skill is how app-building agents learn the framework's contracts and rules without reading the framework's source.

Contracts: none app-facing. Size budgets are PAR-070 to PAR-072.

## 1. Requirements

#### SKILL-REQ-001 — Layered structure
Origin: provenance-unclear · Derives from: SYS-REQ-029

The skill MUST consist of:
- a router (`SKILL.md`, at most PAR-070) that states the hard rules and maps tasks to references;
- one reference per capability and workflow (each at most PAR-071);
- complete working examples (each at most PAR-072);
- templates applied by the scaffolder.

#### SKILL-REQ-002 — Read only what the task needs
Origin: provenance-unclear · Derives from: SYS-REQ-029

The router MUST map common tasks to the references they need: adding an endpoint, storing data, handling files, adding an admin page, testing, and deploying. Each reference MUST open with "read this when" and end with a stopping condition.

#### SKILL-REQ-003 — Hard rules for app agents
Origin: provenance-unclear · Derives from: SYS-REQ-006, SYS-REQ-025

The router MUST require app agents to:
- use only the framework's public exports;
- pass `verify` before declaring work done;
- never change framework version pins;
- record a suspected framework defect in a reproducible `FRAMEWORK-ISSUE.md` instead of working around the framework.

These rules govern app agents only; agents implementing the framework fix framework defects directly (DEC-0056).

#### SKILL-REQ-004 — Tested examples
Origin: provenance-unclear · Derives from: SYS-REQ-029

Every example and template MUST type-check and pass `verify` in the framework's own CI. Examples MUST come from the template or the compliance reference app, never from the demo (DEC-0054).

#### SKILL-REQ-005 — Safe scaffolding
Origin: provenance-unclear · Derives from: SYS-REQ-029

The scaffolder MUST NOT overwrite existing files unless explicitly told to.

#### SKILL-REQ-006 — Owner tasks documented
Origin: owner · Derives from: SYS-REQ-018, SYS-REQ-019

The skill and the template's README MUST contain step-by-step instructions for the tasks the owner performs:
- finding one's user ID and adding it to the admin list;
- one-time account setup;
- setting secrets;
- setting up the Google client;
- deploying and removing stages.

## 2. Design

**Layout.** `skill/SKILL.md`, `skill/reference/`, `skill/examples/`, `skill/templates/`, `skill/scripts/scaffold`.

**References** cover:
- HTTP and validation;
- SQL and migrations;
- KV;
- files;
- secrets;
- configuration;
- current user;
- log;
- local development;
- deploying;
- testing.

**Diagnostics** from CHECK name the reference to read.

**The template** (`apps/template/`) is the smallest app that uses every capability once, with tests. It is the starting point the scaffolder copies.

## 3. Uses

CORE (export list), CHECK, CLI, and the contracts of every capability.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| SKILL-AC-001 | A size check confirms every document is within its budget, and a link check confirms the router links to every reference and each reference links to its examples. | SKILL-REQ-001 | Local |
| SKILL-AC-002 | Every reference opens with "read this when" and ends with a stopping condition; the router covers each listed task. | SKILL-REQ-002 | Local |
| SKILL-AC-003 | The router states each hard rule. | SKILL-REQ-003 | Local |
| SKILL-AC-004 | CI type-checks and runs every example and the template. No example file is derived from `apps/demo/`. | SKILL-REQ-004 | Local |
| SKILL-AC-005 | Scaffolding into a directory with existing files stops without changing them. | SKILL-REQ-005 | Local |
| SKILL-AC-006 | Following only the documented owner steps, a tester sets up an account, deploys, becomes admin, and removes the stage. | SKILL-REQ-006 | Cloud |
