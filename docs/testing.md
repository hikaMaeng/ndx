# Testing

## Commands

```bash
yarn build
yarn test
npm run deploy
```

Install verification, when required:

```bash
npm publish --registry https://verdaccio.neurondev.net/
npm install -g @neurondev/ndx@<version> --registry https://verdaccio.neurondev.net/
ndx --version
ndxserver --version
```

## Coverage Areas

- Settings discovery, version normalization, merge precedence, model pools, MCP
  declarations, and global bootstrap.
- Model provider normalization for OpenAI Responses, Chat Completions fallback,
  Anthropic Messages, inference parameters, and sticky model routing.
- Agent loop behavior, full client-side context follow-up, tool execution,
  worker process isolation, abort propagation, and runtime event replay.
- Session server local account create/login/previous/block/unblock flow,
  WebSocket request/notification flow, SQLite persistence,
  `session`/`sessiondata` metadata, project-id scoping, legacy session-table
  removal, session restore/delete, ownership reclaim, and dashboard reload.
- Lite context mode at user-turn boundaries, including completed turns and
  failed `maxTurns` turns with persisted tool logs.
- Managed CLI startup discovery, detached `ndxserver` process lifetime, default
  socket/dashboard port reporting, and attach-before-start behavior.
- Docker sandbox state, container labels, path mapping, image override, and
  external tool/MCP sandbox execution.

## Browser Verification

The dashboard is the only browser surface. Browser checks must target:

- `main[aria-labelledby="dashboard-title"][data-testid="ndx-dashboard"]`
- `aside aria-label="Dashboard menu"`
- `nav aria-label="Server actions"`
- buttons named `Reload` and `Exit`
- `role="status"` or `role="alert"` for action output
- `data-testid="dashboard-sources"`
- `data-testid="dashboard-bootstrap"`

Prefer Playwright role/name locators where available. Use documented test ids
only for stable non-user-facing anchors.

## Test Records

Feature verification plans live at `tests/plans/{name}-YYYYMMDD.md`. Execution
reports live at `tests/reports/{name}/YYYYMMDD_HHMMSS.md`. Browser reports must
record the locator strategy that passed.
