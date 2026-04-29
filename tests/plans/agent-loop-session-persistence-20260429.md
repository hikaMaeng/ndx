# Test Plan: agent-loop-session-persistence

## Created

2026-04-29

## Goal

Verify the agent-loop documentation covers live session/thread state, rollout
JSONL persistence, prompt history JSONL, app-server subscription delivery, and
the gap between Rust Codex and the TypeScript runtime.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Shell: bash
- Verification: repository search plus standard deploy path

## Preconditions

- The repository contains `codex-rs/core`, `codex-rs/rollout`, and
  `codex-rs/app-server`.
- Existing unrelated working-tree changes are not staged by this task.

## Steps

1. Inspect Rust core thread/session, rollout, history, and app-server files.
2. Update `codex-rs/core/docs/agent-loop.md`.
3. Update `docs/agent-loop.md` with explicit TypeScript gaps.
4. Search the docs for required coverage markers:
   `CodexThread`, `RolloutRecorder`, `history.jsonl`, `ThreadStateManager`,
   `thread/read`, `WebSocket`.
5. Run `npm run deploy`.

## Expected Results

- Rust documentation names the live session/thread structures and persistence
  paths.
- TypeScript documentation states which Rust-origin capabilities are not yet
  implemented.
- Marker search finds every required concept in documentation.
- Deploy completes build, Docker refresh, container tests, mock CLI execution,
  and cleanup.

## Logs To Capture

- Marker search output.
- `npm run deploy` result.
- Any missing coverage or deploy failures.

## Locator Contract

Not applicable. This change has no browser-rendered UI.
