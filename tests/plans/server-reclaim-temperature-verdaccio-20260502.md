# Test Plan: server-reclaim-temperature-verdaccio

## Created

2026-05-02

## Goal

Verify startup reclamation of ndx-owned Docker sandbox containers, model
`temperature` propagation with existing inference parameters, package version
bump, and installed Verdaccio package behavior.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Branch: `codex/dashboard-webserver`
- Package version: `0.1.5`
- Verdaccio: `https://verdaccio.neurondev.net/`
- Docker: local Docker engine through `docker`

## Preconditions

- Docker is available.
- Verdaccio credentials are available through local npm config.
- Repository dependencies are installed with `yarn install --immutable`.

## Steps

1. Run `yarn build`.
2. Run focused tests for config, model adapters, and CLI workspace Docker label
   contracts.
3. Run `yarn test`.
4. Run `npm run deploy`.
5. Publish `@neurondev/ndx@0.1.5` to Verdaccio.
6. Install `@neurondev/ndx@0.1.5` from Verdaccio into an isolated npm prefix.
7. Verify installed `ndx --version` and `ndxserver --version`.
8. Create a labeled stale ndx sandbox container.
9. Start the installed `ndxserver` with Docker sandboxing enabled and a local
   project settings file.
10. Verify startup removes the stale container and starts the current workspace
    sandbox with ndx owner labels.

## Expected Results

- `temperature` is parsed from model settings.
- OpenAI Responses and Chat fallback payloads include `temperature` and existing
  inference fields.
- Anthropic payloads include supported inference fields: `max_tokens`,
  `temperature`, `top_p`, and `top_k`.
- Server-owned Docker sandbox containers have owner/workspace/image labels.
- Sandboxed server startup removes prior ndx-owned containers before creating
  the current workspace sandbox.
- The installed Verdaccio package exposes version `0.1.5` through both binaries.

## Logs To Capture

- Build/test/deploy summaries.
- `npm publish` result.
- Installed binary paths and version output.
- Docker stale-container removal check.
- Current sandbox labels.

## Locator Contract

No browser UI change in this task. Existing dashboard locator contract remains
covered by `dashboard-webserver-20260502.md`.
