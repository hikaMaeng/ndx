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
- Global `/home/.ndx/search.json` rule loading.
- Provider/model resolution from settings.
- Model pool parsing for `session`, `worker`, `reviewer`, and `custom`.
- Sticky model routing across the session pool after the first selected-pool binding.
- Custom model pool selection with `@keyword` prompt routing.
- Object model catalogs with aliases, provider-facing names, effort, thinking, and sampling parameters.
- `/model` command state changes for model, effort, and thinking mode.
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
- WebSocket session server request/notification flow.
- Session server startup bootstrap report in `initialize` and `session/configured`.
- Server-side JSONL persistence under `<globalDir>/sessions/ts-server`.
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
- Session owner file contention waits and retries before restore claims
  ownership.
- Session JSONL writes performed by a child writer process, not the main process.
- Queue drain after clients disconnect without an explicit session close command.
- Multiple WebSocket clients subscribed to the same live session.
- Provider error classification for non-retryable and retryable failures.
- Docker remote-clone build using the selected `NDX_GIT_REF` branch.
- Docker workspace and global settings bind mounts under `./docker/volume`.
- Docker build, in-container tests, and in-container mock agent execution.
- Deploy verification uses non-interactive `docker compose run -T` so test and mock-agent containers exit cleanly even though the service keeps `tty: true` for manual use.

## Browser Verification

No browser UI exists in the current TypeScript agent. Browser verification is not required for this package.
