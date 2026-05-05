ndx is a TypeScript-first local coding agent with a host WebSocket session server and Docker-backed tool sandbox.

| Goal               | File                 |
| ------------------ | -------------------- |
| Understand purpose | docs/overview.md     |
| Architecture       | docs/architecture.md |
| API reference      | docs/api.md          |
| Usage              | docs/usage.md        |
| Constraints        | docs/constraints.md  |
| Internals          | docs/internals.md    |
| Testing            | docs/testing.md      |

## Quick Start

```bash
yarn install --immutable
yarn build
node dist/src/cli/main.js --mock "list files"
```

Install-test releases use Verdaccio:

```bash
npm install -g @neurondev/ndx --registry https://verdaccio.neurondev.net/
ndx
```

`ndx` accepts one normal startup argument: an optional WebSocket server address.
When no reachable server is supplied, the CLI starts a detached local
server for the current folder, then connects to it. On Windows, plain
`ndxserver` is also a background server trigger; use `ndxserver serve` for a
foreground server terminal. The server continues running after the CLI exits
and ignores terminal shutdown signals until `ndxserver stop` is run or the
dashboard exit action is used. Docker is used only for workspace-bound external
tool and MCP execution.

Startup context includes cascading AGENTS.md files and local skills. Global
instructions are read from `/home/.ndx/AGENTS.override.md` or
`/home/.ndx/AGENTS.md`; project instructions are read from the detected project
root down to the session cwd. Skills are discovered from `/home/.ndx/skills`,
project `.ndx/skills`, and `.agents/skills`, summarized in context, and fully
loaded only when mentioned with `$skill-name` or a linked `SKILL.md` path.

## Verification

```bash
npm run deploy
```

The deploy script builds and tests TypeScript, removes prior compose resources,
rebuilds the sandbox image, starts `ndx-sandbox`, verifies a sandbox write, and
tears the compose stack down.

## License

Apache License 2.0. This project is based on
[OpenAI Codex](https://github.com/openai/codex), Copyright 2025 OpenAI.
