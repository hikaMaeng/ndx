# Testing

## Policy

`ndx` uses agenttest as the repository testing policy. Agenttest suites are
strict JSON files executed by Codex through the filesystem-backed TypeScript
runner in the global `agenttest` skill.

Use `test/YYYYMMDD/HHMMSS_*.json` for suites, the sibling
`HHMMSS_report.json` for strict results, and `HHMMSS_summary.md` only as the
derived human summary. Do not create or restore root `tests/`, `tests/plans`,
or `tests/reports`; those paths belonged to the pre-agenttest policy and are
not authoritative in the monorepo.

## Commands

```bash
yarn build
yarn test
npm run deploy
```

`yarn build` runs `turbo run build` across `apps/*` and `packages/*`.
`npm run deploy` runs the Turbo build, the agenttest policy hook, legacy compose
cleanup, isolated compose build from `apps/toolcontainer`, compose up, sandbox
write verification, and final compose down.

Build output and local runtime artifacts are disposable. Root `dist/`,
`.turbo/`, `.yarn/unplugged/`, `.yarn/install-state.gz`, and non-placeholder
contents under `docker/volume/` must not be committed. The only tracked Docker
volume entries are `docker/volume/home-ndx/.gitkeep` and
`docker/volume/workspace/.gitkeep`.

Install verification, when required:

```bash
npm publish --registry https://verdaccio.neurondev.net/
npm install -g @neurondev/ndx@<version> --registry https://verdaccio.neurondev.net/
ndx --version
ndxserver --version
```

Release install acceptance must use a filesystem sandbox outside this
repository. The 0.1.40 release suite records Verdaccio publish, dedicated-prefix
install, and a Tetris project creation smoke in
`test/20260508/214231_publish-install-tetris.json`.

Tool failures from task tools must remain inside the active turn as tool output
unless an abort signal is active. The 0.1.41 missing MCP resource regression is
recorded in `test/20260509/013818_mcp-resource-cli-error.json`.

## Coverage Areas

- Settings discovery, version normalization, merge precedence, model pools, MCP
  declarations, AGENTS.md cascade behavior, skill discovery, and global
  bootstrap.
- Model provider normalization for OpenAI Responses, Chat Completions fallback,
  Anthropic Messages, inference parameters, and sticky model routing.
- Agent loop behavior, full client-side context follow-up, tool execution,
  explicit skill injection, built-in skill loading, duplicate skill
  suppression, unavailable interactive input exclusion, worker process
  isolation, abort propagation, and runtime event replay.
- Session server local account create/login/previous/block/unblock flow,
  WebSocket request/notification flow, SQLite persistence,
  `session`/`sessiondata` metadata, project-id scoping, legacy session-table
  removal, v2 account FK migration, session restore/delete, ownership reclaim,
  and dashboard reload.
- Lite context mode at user-turn boundaries, including completed turns and
  failed `maxTurns` turns with persisted tool logs.
- Managed CLI startup discovery, detached `ndxserver` process lifetime, default
  socket/dashboard port reporting, and attach-before-start behavior.
- Docker sandbox state, container labels, path mapping, image override, Windows
  host-path mapping, and external tool/MCP sandbox execution.
- Monorepo package boundaries: app-to-package dependency direction, no
  package-to-app imports, public bin compatibility, `@neurondev/ndx-core`
  subpath exports, and Docker build-context ownership.

## Browser Verification

The dashboard is the only browser surface. Browser checks must target:

- `main[aria-labelledby="dashboard-title"][data-testid="ndx-dashboard"]`
- `aside aria-label="Dashboard menu"`
- `nav aria-label="Dashboard views"`
- `nav aria-label="Server actions"`
- buttons named `Overview`, `Session Logs`, and `Users`
- buttons named `Reload` and `Exit`
- `role="status"` or `role="alert"` for action output
- `data-testid="dashboard-server-stats"`
- `data-testid="dashboard-sources"`
- `data-testid="dashboard-bootstrap"`
- `data-testid="dashboard-session-logs"` and `data-testid="session-log-table"`
- `data-testid="session-log-detail"` and `data-testid="session-log-events"`
- `data-testid="dashboard-users"` and `data-testid="users-table"`

Prefer Playwright role/name locators where available. Use documented test ids
only for stable non-user-facing anchors.
