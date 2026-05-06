ndx is a TypeScript-first local coding agent monorepo with install-compatible CLI bins and a Docker-backed tool sandbox.

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
node apps/ndx/dist/bin/ndx.js --mock "list files"
```

Install-test releases keep the public package name and bins:

```bash
npm install -g @neurondev/ndx --registry https://verdaccio.neurondev.net/
ndx --version
ndxserver --version
```

`apps/ndx` publishes `@neurondev/ndx` and keeps both `ndx` and `ndxserver`
bins. Runtime logic lives in `packages/ndx` as `@neurondev/ndx-core`; app
packages are wrappers only. `apps/toolcontainer` owns the sandbox Docker build
context used by root `docker-compose.yml`.

## Verification

```bash
npm run deploy
```

The deploy script runs the Turbo build and agenttest policy hook, removes prior
compose resources, rebuilds and starts `ndx-sandbox`, verifies a sandbox write,
and tears the compose stack down.

## License

Apache License 2.0. This project is based on
[OpenAI Codex](https://github.com/openai/codex), Copyright 2025 OpenAI.
