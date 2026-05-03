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
`ndxserver` host process for the current folder, then connects to it. The server
continues running after the CLI exits until `ndxserver` receives a shutdown
signal or the dashboard exit action is used. Docker is used only for
workspace-bound external tool and MCP execution.

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
