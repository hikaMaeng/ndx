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
node dist/src/cli.js --mock "create a file named tmp/verify.txt with text verified"
```

Use a real model by setting `OPENAI_API_KEY` and running without `--mock`.

## Docker Verification

```bash
npm run deploy
```

The deploy script builds TypeScript, refreshes the compose target, runs tests in Docker, and executes the mock agent through the shell tool.

## License

Apache License 2.0. This project is based on [OpenAI Codex](https://github.com/openai/codex), Copyright 2025 OpenAI.
