# Runtime Event Protocol Test Plan

## Scope

Feature branch: `codex/runtime-event-protocol`

This plan covers the P0 runtime foundation step: session configuration, user turn lifecycle, interrupt contract, provider error classification, and preservation of the existing CLI/agent loop behavior.

## Commands

```bash
npm test
docker compose config
npm run deploy
NDX_GIT_REF=codex/runtime-event-protocol docker compose up -d --build ndx-agent
docker compose exec -T ndx-agent ndx --help
docker compose exec -T ndx-agent ndx --mock "create a file named tmp/runtime-event-protocol.txt with text verified"
```

## Acceptance Criteria

- Unit tests pass for existing config and shell tool behavior.
- Runtime emits `session_configured`, `turn_started`, `tool_call`, `tool_result`, `agent_message`, and `turn_complete` in deterministic order with the mock provider.
- Interrupt submissions emit `turn_aborted`.
- Model/provider errors are classified for future retry policy.
- Docker compose config is valid.
- Docker clone build succeeds from `NDX_GIT_REF=codex/runtime-event-protocol`.
- In-container `ndx --help` and mock execution both work.
