# codex-core overview

`codex-core`는 Codex 스레드, 세션, 턴 실행, 모델 스트리밍, 도구 실행, 훅, 컨텍스트 이력을 소유한다.

| Goal | File |
|------|------|
| Agent loop internals | `docs/agent-loop.md` |
| Architecture | `docs/architecture.md` |
| API surface | `docs/api.md` |
| Usage contracts | `docs/usage.md` |
| Constraints | `docs/constraints.md` |
| Internal state | `docs/internals.md` |
| Testing | `docs/testing.md` |

Primary code paths:

- `src/session/handlers.rs`: submission loop and `Op` dispatch.
- `src/tasks/mod.rs`: task lifecycle, active-turn ownership, cancellation.
- `src/tasks/regular.rs`: regular agent task loop.
- `src/session/turn.rs`: model sampling loop.
- `src/stream_events_utils.rs`: completed response item handling.
- `src/tools/`: tool routing, dispatch, hook integration.
- `src/context_manager/`: prompt history, context diffing, token accounting.

