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
ndx
```

The host CLI first probes saved workspace socket URLs for an ndx session server.
Inside the standard container workspace it also probes `ws://127.0.0.1:45123`.
Only when no server socket is reachable does it ask the setup question and start
the Docker-managed fallback. Use `--mock` for local source-tree development
without Docker.

Use a real model by configuring provider settings in `.ndx/settings.json` or
local global `/home/.ndx/settings.json`.

## Docker Verification

```bash
npm run deploy
```

The deploy script builds TypeScript locally, then builds the Docker image by cloning the current pushed Git branch selected by `NDX_GIT_REF`, runs tests in Docker, and executes the mock agent through the shell tool. Runtime workspace and global settings are bind-mounted under `./docker/volume`.

`ndx serve` and `ndxserver` expose an authenticated WebSocket socket port plus
an unauthenticated dashboard HTTP port. Accounts, social account links, and
sessions are stored in SQLite at `/home/.ndx-data/ndx.sqlite` by default. Host
CLI last-login state is stored in the CLI app-state directory, not in `.ndx`.

## License

Apache License 2.0. This project is based on [OpenAI Codex](https://github.com/openai/codex), Copyright 2025 OpenAI.
