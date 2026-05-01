# Testing

## Commands

```bash
npm test
npm run deploy
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
- Session server keeps sessions on the base config while provider routing happens per request.
- Missing global and project settings fail in the loader without falling back to a default model.
- TTY setup wizard creates project `.ndx/settings.json` from permission, provider, model, and context answers.
- Provider type validation for `openai` and `anthropic`.
- Global `.ndx` bootstrap for missing core directories, built-in core tool package files, and skills directory.
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
- Managed Docker bootstrap compose-state generation under `.ndx/system/managed`
  without placing CLI login state in project `.ndx`.
- Managed startup probes the requested ndx socket before invoking Docker and
  verifies `initialize.server` is `ndx-ts-session-server`.
- Interactive managed startup asks for a workspace folder only when Docker
  fallback is needed, then project selection uses a subfolder of that workspace.
- Session server project listing and project folder creation.
- WebSocket session server request/notification flow.
- Session server startup bootstrap report in `initialize` and `session/configured`.
- Server-side SQLite persistence under `<dataDir>/ndx.sqlite`.
- Account create/login/password-change methods and WebSocket client identity.
- Social login account creation from a verified provider profile response.
- Socket authentication requirement for session, command, and turn methods.
- Dashboard placeholder HTTP response and stable browser locator contract.
- Workspace-scoped session listing, restore by session id or list number, and
  non-current session deletion.
- Restore rebuilds provider-facing model conversation history from saved
  runtime events.
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
- Docker sandbox image build and `/workspace` bind mount behavior.
- Deploy verification uses non-interactive `docker compose exec -T` for sandbox
  shell execution.
- Server startup verification should run the local server, confirm it logs in
  before initialization, fetch the dashboard through the local dashboard port,
  and verify that shell-like tools execute through the pinned Docker sandbox.
- Repository hygiene checks keep the root package as the only package and keep
  generated dependency, build, and Docker runtime state out of tracked source.
- Yarn Plug'n'Play with the global cache enabled is the package-install
  contract; workspace `node_modules` directories are not expected.

## Browser Verification

The current browser surface is the dashboard placeholder served by the
dashboard listener at `/` and `/dashboard`.

Locator contract:

- `main` landmark named by the `ndx Agent Service` heading.
- `role="status"` for the placeholder status text.
- `data-testid="agent-dashboard-placeholder"` for a stable non-user-facing
  anchor.
