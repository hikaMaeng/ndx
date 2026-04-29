# Test Plan: codex-core-agent-loop-docs

## Created

2026-04-29

## Goal

Verify the `codex-core` agent-loop documentation addition and the repository deploy contract after adding documentation-only files under `codex-rs/core/docs`.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Shell: `bash`
- Runtime target: root `npm run deploy`
- Docker target: `ndx-agent:local`

## Preconditions

- Documentation files exist under `codex-rs/core/docs`.
- No Rust source files are changed by this task.
- Pre-existing dirty worktree entries are not part of this verification.

## Steps

1. List the new `codex-rs/core/docs` files.
2. Search the documentation for key coverage markers: `system-remainder`, `Agent loop internals`, `탈출 조건`, `hook 삽입점`.
3. Run `npm run deploy` from the repository root.
4. Confirm the deploy path runs local TypeScript build, Docker compose refresh/build, containerized tests, mock runtime verification, and compose cleanup.

## Expected Results

- Required package documentation files are present.
- `docs/agent-loop.md` documents loop entry, continuation, exit, async waits, tool dispatch, context management, prompt markers, hooks, and subagent mailbox/status behavior.
- `npm run deploy` exits successfully.
- Containerized Node tests pass.
- Mock verification writes and reads `tmp/ndx-docker-verify.txt` inside the container.

## Logs To Capture

- Documentation file list and marker search output.
- `npm run deploy` high-signal output: build pass, Docker image build, test TAP summary, mock verification output, compose cleanup.

## Locator Contract

Not applicable. This is documentation and runtime-log verification, not browser verification.

