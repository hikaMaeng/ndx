# Testing

## Commands

```bash
npm test
npm run deploy
npm publish --registry https://verdaccio.neurondev.net/
npm install -g @neurondev/ndx@<version> --registry https://verdaccio.neurondev.net/
```

## Coverage

- Fixed global `/home/.ndx/settings.json` path.
- Nearest project `.ndx/settings.json` discovery.
- Global plus project settings merge precedence.
- Optional `dataPath` SQLite data-directory override and legacy `sessionPath`
  compatibility.
- Global `/home/.ndx/search.json` rule loading.
- Provider/model resolution from settings.
- Model pool parsing for `session`, `worker`, `reviewer`, and `custom`.
- Sticky model routing across the session pool after the first selected-pool binding.
- Custom model pool selection with `@keyword` prompt routing.
- Object model catalogs with aliases, provider-facing names, effort, thinking, and sampling parameters.
- `/model`, `/effort`, and `/think` command state changes for numbered model,
  effort, and thinking mode selection.
- `/context`, `/compact`, and `/lite` command output includes context totals,
  kind breakdown, remaining context, and compaction before/after changes.
- Session server keeps sessions on the base config while provider routing happens per request.
- Missing global and project settings fail in the loader without falling back to a default model.
- TTY setup wizard creates global `/home/.ndx/settings.json` from permission, provider, model, and context answers.
- Provider type validation for `openai` and `anthropic`.
- Global `.ndx` bootstrap for missing `system/tools`, built-in core tool package files, and skills directory.
- OpenAI Responses normalization.
- OpenAI Responses requests omit `previous_response_id`.
- OpenAI Responses function tool schema conversion.
- OpenAI Chat Completions normalization.
- OpenAI Responses-to-Chat fallback on missing `/responses`.
- Anthropic Messages normalization.
- Standalone process runner output capture.
- Standalone process runner abort handling for already-aborted and later-aborted signals.
- Standalone nested serial/parallel `TaskQueue` execution.
- `keys` and compatibility `env` merge into the shell tool environment.
- Mock model plus shell tool execution.
- Agent-owned task tool exposure.
- Bootstrapped core capability tools are exposed from the external core layer.
- Filesystem `tool.json` layer discovery and priority override.
- Project MCP priority over global MCP.
- Every tool call starts a separate Node worker process.
- Agent abort propagation from turn signal to worker and external manifest command process.
- Runtime session event order for session, turn, tool, model message, and completion.
- Runtime interrupt event contract.
- CLI session-client controller initialization, session status, initialization-event display, recent-event display, and interactive command help.
- CLI `/login` default-user switching and shared login-store update.
- Managed startup reports local current-folder sandbox metadata without
  generating server compose state.
- Managed startup probes the requested ndx socket before starting the local
  fallback server and verifies `initialize.server` is `ndx-ts-session-server`.
- Interactive managed startup uses the current folder directly and does not ask
  for a workspace folder or project selection.
- Session server API omits project listing and project creation.
- WebSocket session server request/notification flow.
- Session server startup bootstrap report in `initialize` and `session/configured`.
- Dashboard Reload re-runs `.ndx` bootstrap and re-reads settings plus
  `AGENTS.md` sources for later sessions.
- CLI initialization output includes the connected server dashboard URL.
- CLI startup output prints public `server/info` version, host runtime, tool
  sandbox image, and protocol before the login prompt.
- Server-side SQLite persistence under `<dataDir>/ndx.sqlite`.
- Account create/login/password-change methods and WebSocket client identity.
- Social login account creation from a verified provider profile response.
- Socket authentication requirement for session, command, and turn methods.
- Dashboard HTTP response, Reload action, and stable browser locator contract.
- Windows host path mapping for Docker sandbox `exec -w` values.
- Workspace-scoped session listing, restore by session id or list number, and
  non-current session deletion.
- Restore rebuilds provider-facing model conversation history from saved
  context items rather than notification or server-control records.
- Restore replays `context_compacted` events as the replacement model context
  before applying later turn events.
- SQLite list and ownership checks use indexed session projection rows; tests
  should assert `event_count`, `last_event_id`, and context replay rows when
  persistence behavior changes.
- Agent tool follow-up requests include the full local client-side context stack.
- Empty sessions stay unnumbered and unpersisted until the first prompt.
- Session ownership is reclaimed by the last socket server that attempts a prompt.
- Deleted sessions notify stale socket owners and close the stale server on the
  next prompt attempt or completed response.
- Turn start persistence is flushed before runtime execution so fast Docker
  mock responses do not look like externally deleted session files.
- Session server shutdown destroys upgraded WebSocket sockets after sending
  close frames so tests and CLI teardown do not hang on peer close handshakes.
- Session ownership is tracked in SQLite and reclaimed by the last prompt owner.
- `session_detached` record after clients disconnect without an explicit session close command.
- Multiple WebSocket clients subscribed to the same live session.
- Provider error classification for non-retryable and retryable failures.
- Docker sandbox image build, `ndx-tool-<folder-name>` naming, `/workspace`,
  `/home/.ndx`, and Docker socket bind mount behavior.
- Docker sandbox run arguments are rendered from the server-owned template in
  `src/session/docker-sandbox.ts`; tests should cover the generated argv
  contract, not only labels.
- Docker sandbox reuse by physical project folder and label-based discovery
  after server restart.
- Docker sandbox labels identify ndx server-owned containers, and sandboxed
  server startup reclaims prior ndx-owned containers before creating the current
  workspace sandbox.
- Settings version compatibility: valid global and project settings with stale
  or missing `"version"` are updated in place; incomplete settings are repaired
  by the TTY wizard in global-then-project order.
- Deploy verification uses non-interactive `docker compose exec -T` for sandbox
  shell execution.
- Each code change bumps the package version and verifies the exact published
  Verdaccio version through installed `ndx`/`ndxserver` binaries.
- Server startup verification should run the local server, confirm it logs in
  before initialization, fetch the dashboard through the local dashboard port,
  and verify that external tools plus restored sessions execute through the
  pinned Docker sandbox.
- CLI session-client tests cover pre-login server info display, startup login
  prompting, server version display, compact bootstrap output, and restored
  context usage formatting.
- Repository hygiene checks keep the root package as the only package and keep
  generated dependency, build, and Docker runtime state out of tracked source.
- Yarn Plug'n'Play with the global cache enabled is the package-install
  contract; workspace `node_modules` directories are not expected.

## Browser Verification

The current browser surface is the dashboard served by the dashboard listener
at `/` and `/dashboard`.

Locator contract:

- `main` landmark named by the `Server Dashboard` heading.
- `aside` named `Dashboard menu`.
- Buttons named `Reload` and `Exit` inside `nav aria-label="Server actions"`.
- `role="status"` for dashboard action status; `role="alert"` for failed
  dashboard action status.
- `data-testid="ndx-dashboard"`, `dashboard-action-status`,
  `dashboard-sources`, and `dashboard-bootstrap` for stable anchors.
