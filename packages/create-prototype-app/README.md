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
5. runs `npm install`;
6. runs `git init` (unless the folder is already inside a git repository);
7. sets a random local value for each of the app's secrets in `.dev.vars`, and makes sure `.gitignore` lists `.env.cloudflare`;
8. makes the first commit.

It asks for no account. If git is missing or a git step fails, it warns and carries on. It ends with what to do next: `cd my-app`, then `npm run dev`, or open the folder in Claude Code and say what to build.

Later, `npm run upgrade` moves the app to a newer framework release and refreshes its skill copy, and `npm run version-check` says whether that is worth doing.

Node.js 22.22.0 is what the framework requires.

## Options

Pass options after `--` with `npm create`, for example `npm create @lago-morph/prototype-app@latest my-app -- --no-install`.

| Option | Does |
| --- | --- |
| `--name <app>` | App name instead of one made from the folder name |
| `--framework <spec>` | Another dependency spec for the framework, such as a `file:` tarball path |
| `--no-install` | Skip `npm install`, and the local secrets that need it |
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
