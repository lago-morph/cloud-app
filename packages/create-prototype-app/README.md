# @lago-morph/create-prototype-app

Starts a new app on [@lago-morph/prototype-framework](https://www.npmjs.com/package/@lago-morph/prototype-framework).

```sh
npm create @lago-morph/prototype-app@latest my-app
cd my-app
npm run dev
```

`npm create @lago-morph/prototype-app` runs this package (npm maps `@scope/name` to `@scope/create-name`). It:

1. copies the framework's template app into `my-app` (the folder must be empty or not exist);
2. names the app after the folder: `package.json` `name`, and the app name in `src/app.ts` and `index.html` (1 to 20 lowercase letters and digits; pass `--name` to choose another);
3. pins `@lago-morph/prototype-framework` at the release that matches this package's version;
4. copies the Claude Code skill for the framework into `.claude/skills/prototype-framework/`, so Claude Code finds it in the app's folder;
5. runs `npm install`.

Node.js 22.22.0 is what the framework requires.

## Options

Pass options after `--` with `npm create`, for example `npm create @lago-morph/prototype-app@latest my-app -- --no-install`.

| Option | Does |
| --- | --- |
| `--name <app>` | App name instead of one made from the folder name |
| `--framework <spec>` | Another dependency spec for the framework, such as a `file:` tarball path |
| `--no-install` | Skip `npm install` |
| `--no-skill` | Do not copy the skill (install the plugin instead, below) |
| `--force` | Overwrite files in a folder that is not empty |

## The skill as a Claude Code plugin

Instead of the copied skill, you can install it once for all your apps:

```text
/plugin marketplace add lago-morph/cloud-app
/plugin install prototype-framework@lago-morph
```

This package has no runtime dependencies.

## License

MIT
