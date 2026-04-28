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
- `keys` and compatibility `env` merge into the shell tool environment.
- Mock model plus shell tool execution.
- Agent-owned task tool exposure.
- Filesystem `tool.json` layer discovery and priority override.
- Project MCP priority over global MCP.
- Every tool call starts a separate Node worker process.
- Runtime session event order for session, turn, tool, model message, and completion.
- Runtime interrupt event contract.
- WebSocket session server request/notification flow.
- Server-side JSONL persistence under `<globalDir>/sessions/ts-server`.
- Multiple WebSocket clients subscribed to the same live thread.
- Provider error classification for non-retryable and retryable failures.
- Docker remote-clone build using the selected `NDX_GIT_REF` branch.
- Docker workspace and global settings bind mounts under `./docker/volume`.
- Docker build, in-container tests, and in-container mock agent execution.

## Browser Verification

No browser UI exists in the current TypeScript agent. Browser verification is not required for this package.
