# Templates

Files you copy and fill in. The app itself comes from the scaffolder: `skill/scripts/scaffold <new-app-dir>` copies the framework's app template (`apps/template`), which the framework's CI type-checks and tests, so a new app starts from code that passes `verify`.

| File | Copy to | Fill in |
| --- | --- | --- |
| [FRAMEWORK-ISSUE.md](FRAMEWORK-ISSUE.md) | `FRAMEWORK-ISSUE.md` at the app's root, when you first suspect a framework defect | One numbered entry per defect, every field (router, hard rules 6 and 7) |
| [production-stage.json](production-stage.json) | `config/<target>/<stage>.json` for each production stage, for example `config/cloudflare/prod.json` | `values` for keys without defaults; the email sender's display name (`framework.email.senderName`, or remove `email` to use the app name). No admins: they get the `admin` role with `admins grant` ([configuration.md](../reference/configuration.md), [owner-tasks.md](../reference/owner-tasks.md)) |

Test stages need no new file: every `test-*` stage uses the template's `config/<target>/test.json`.
