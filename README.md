ndx is a TypeScript-first local coding agent derived from openai/codex.

| Goal               | File                 |
| ------------------ | -------------------- |
| Understand purpose | docs/overview.md     |
| Architecture       | docs/architecture.md |
| API reference      | docs/api.md          |
| Usage              | docs/usage.md        |
| Constraints        | docs/constraints.md  |
| Internals          | docs/internals.md    |
| Testing            | docs/testing.md      |

## Status

The upstream Codex import is preserved on the local `origin` branch at `09f931e`.
Active development is the root TypeScript package in `src/`, `tests/`, `docs/`,
and the Docker deploy flow. Legacy upstream SDK, Bazel, devcontainer, release,
and third-party trees are intentionally not part of this workspace.

## Quick Start

```bash
npm install -g @neurondev/ndx
ndx [SERVER_ADDRESS]
```

`SERVER_ADDRESS` is the only `ndx` startup argument. It defaults to
`127.0.0.1:45123`. The CLI connects to that server first; if it is not
reachable, it reports the miss, starts a local default server at the default
address, logs in, and continues with project/session selection. Docker is used
only as the per-workspace tool sandbox, not as the server process.

Use a real model by configuring provider settings in `.ndx/settings.json` or
local global `/home/.ndx/settings.json`.

## Docker Verification

```bash
npm run deploy
```

The deploy script builds and tests TypeScript locally, removes prior compose
containers, rebuilds the pinned tool-sandbox image, starts it with
`./docker/volume/workspace` mounted at `/workspace`, verifies shell execution,
and tears compose down.

`ndx serve` and `ndxserver` expose an authenticated WebSocket socket port plus
an unauthenticated dashboard HTTP port. Accounts, social account links, and
sessions are stored in SQLite under the user `.ndx/system` directory by default.
Host CLI last-login state is stored in the CLI app-state directory, not in
`.ndx`.

## License

Apache License 2.0. This project is based on [OpenAI Codex](https://github.com/openai/codex), Copyright 2025 OpenAI.
