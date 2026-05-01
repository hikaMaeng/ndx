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
Active development is on the TypeScript CLI in `src/`.

## Quick Start

```bash
pnpm install
npm test
node dist/src/cli/main.js --mock "create a file named tmp/verify.txt with text verified"
```

Use a real model by configuring provider settings in `.ndx/settings.json` or local global `/home/.ndx/settings.json`, then running without `--mock`.

## Docker Verification

```bash
npm run deploy
```

The deploy script builds TypeScript locally, then builds the Docker image by cloning the current pushed Git branch selected by `NDX_GIT_REF`, runs tests in Docker, and executes the mock agent through the shell tool. Runtime workspace and global settings are bind-mounted under `./docker/volume`.

`ndx serve` and `ndxserver` expose an authenticated WebSocket socket port plus
an unauthenticated dashboard HTTP port. Accounts and sessions are stored in
SQLite at `/home/.ndx-data/ndx.sqlite` by default.

## License

Apache License 2.0. This project is based on [OpenAI Codex](https://github.com/openai/codex), Copyright 2025 OpenAI.
