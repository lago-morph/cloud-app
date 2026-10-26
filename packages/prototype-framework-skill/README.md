# @lago-morph/prototype-framework-skill

The Claude Code skill for [`@lago-morph/prototype-framework`](https://www.npmjs.com/package/@lago-morph/prototype-framework), published at the same version as the framework. The package holds only the skill's Markdown files, in `skill/`.

## Install it in Claude Code cloud sessions

Add this to your cloud environment's **Setup script** (environment menu → Edit → Setup script). Set the version to the framework version your apps use. Every new session in that environment then has the skill. Nothing is installed and no package scripts run: `npm pack` only downloads the archive.

```sh
set -euo pipefail
d=$(mktemp -d); cd "$d"
npm pack -q @lago-morph/prototype-framework-skill@0.1.0
tar xzf ./*.tgz
mkdir -p ~/.claude/skills
rm -rf ~/.claude/skills/prototype-framework
cp -r package/skill ~/.claude/skills/prototype-framework
```

## Other ways to get the skill

- **On your own computer:** apps made with `npm create @lago-morph/prototype-app` carry the skill in `.claude/skills/prototype-framework/`.
- **As a plugin:** add the marketplace with `/plugin marketplace add lago-morph/cloud-app`, then install it with `/plugin install prototype-framework@lago-morph`.
