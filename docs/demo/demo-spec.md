# DEMO — Photo board demo app

A small shared photo board that exercises every framework capability on every target. It is written as **app requirements**, not implementation steps: an AI agent builds it using only the skill and the framework's public exports, so building it also tests the skill (DEC-0054). Where the agent finds the skill or framework lacking, it records a `FRAMEWORK-ISSUE.md` entry instead of working around the gap.

The theme follows the owner's first planned app, which uploads high-resolution photos (DEC-0071).

## 1. Requirements

#### DEMO-REQ-001 — Posts
Origin: ai-proposed · Derives from: SYS-REQ-030

A post has a title (1–120 characters), a text body, an author, a status (`draft` or `published`), and creation and update times. Anyone, including anonymous visitors, can list published posts newest first, with pages, and open one. User-provided text is always displayed as text, never interpreted as HTML.

#### DEMO-REQ-002 — Who may do what
Origin: ai-proposed · Derives from: SYS-REQ-017, SYS-REQ-030

| Action | Anonymous | User | Admin |
| --- | --- | --- | --- |
| View published posts | yes | yes | yes |
| Create a draft; edit or delete own drafts | — | yes | yes |
| View own drafts | — | yes | yes |
| Publish, unpublish, or delete any post | — | — | yes |
| Set the site banner | — | — | yes |

#### DEMO-REQ-003 — Photos
Origin: ai-proposed · Derives from: SYS-REQ-014, SYS-REQ-030

A post's author can attach JPEG or PNG photos to a draft, up to the configured maximum per post. Photos of any size the framework supports must work, including files much larger than 6 MB. Photos display in the post. Deleting a post deletes its photo records and then its photo files. If deleting a file fails, the failure is logged and the post is still deleted.

#### DEMO-REQ-004 — Site banner
Origin: ai-proposed · Derives from: SYS-REQ-013, SYS-REQ-030

An admin can set or clear a banner message shown at the top of every page for everyone.

#### DEMO-REQ-005 — Personal preference
Origin: ai-proposed · Derives from: SYS-REQ-013, SYS-REQ-030

A logged-in user can choose how many posts appear per page; the choice persists across sessions.

#### DEMO-REQ-006 — Configuration
Origin: ai-proposed · Derives from: SYS-REQ-016, SYS-REQ-030

The site title, the maximum photos per post, and the share-link lifetime in days come from configuration.

#### DEMO-REQ-007 — Share links
Origin: ai-proposed · Derives from: SYS-REQ-015, SYS-REQ-030

A post's author can create a share link for a draft. The link lets anyone who has it view that draft until the link expires. Links are signed with an app secret, so they cannot be forged or altered.

#### DEMO-REQ-008 — Log
Origin: ai-proposed · Derives from: SYS-REQ-021, SYS-REQ-030

The app logs publish, unpublish, and delete actions at `info`, and photo-cleanup failures at `warn`.

#### DEMO-REQ-009 — Account page
Origin: ai-proposed · Derives from: SYS-REQ-018, SYS-REQ-030

The app has login and logout controls and an account page that shows the logged-in user's user ID, with a button to copy it, so the owner can add it to the admin list.

#### DEMO-REQ-010 — Everywhere, unchanged
Origin: owner-approved · Derives from: SYS-REQ-001, SYS-REQ-030

The same source runs locally and on both clouds. The app includes a smoke test that exercises each requirement above against a deployed test stage.

## 2. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| DEMO-AC-001 | Anonymous visitors see only published posts, newest first, paginated. A title containing `<script>` renders as text. | DEMO-REQ-001 | Local, cloud |
| DEMO-AC-002 | Each cell of the permissions table is exercised with mock identities; forbidden actions are refused. | DEMO-REQ-002 | Local, cloud |
| DEMO-AC-003 | A 20 MB JPEG uploads, displays, and is byte-identical when downloaded. The per-post maximum is enforced. Deleting the post removes its rows and files. A simulated file-deletion failure produces a `warn` log entry. | DEMO-REQ-003 | Local, cloud |
| DEMO-AC-004 | A banner set by an admin appears for anonymous visitors; users cannot set it. | DEMO-REQ-004 | Local, cloud |
| DEMO-AC-005 | A user's posts-per-page choice survives logout and login. | DEMO-REQ-005 | Local, cloud |
| DEMO-AC-006 | Changing the site title in configuration and redeploying changes the displayed title. | DEMO-REQ-006 | Local, cloud |
| DEMO-AC-007 | A share link shows the draft to an anonymous visitor. An altered or expired link is refused. | DEMO-REQ-007 | Local, cloud |
| DEMO-AC-008 | Publish and delete actions produce `info` entries in the target's log. | DEMO-REQ-008 | Local, cloud |
| DEMO-AC-009 | The account page shows the same ID as `/api/auth/me`, and the copy button copies it. | DEMO-REQ-009 | Local, cloud |
| DEMO-AC-010 | The smoke test passes on local, Cloudflare, and AWS from one commit with no source changes. | DEMO-REQ-010 | Local, cloud |
