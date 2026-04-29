# Test Plan: process-library
## Created
2026-04-29
## Goal
Verify the new `codex-process` library compiles and covers process execution,
process cancellation, serial queue execution, and task cancellation hooks.
## Environment
Run from `/mnt/f/dev/ndx/codex-rs` with the active Rust toolchain and workspace
dependencies.
## Preconditions
The workspace includes the new `process` member and no `codex-*` dependency is
declared by `codex-rs/process/Cargo.toml`.
## Steps
1. Run `cargo test -p codex-process`.
2. Run `just fmt`.
3. Run `just fix -p codex-process`.
## Expected Results
All package tests pass. Formatting succeeds. Scoped clippy fix completes without
requiring manual corrections.
## Logs To Capture
Command, exit status, and relevant failure output for each step.
## Locator Contract
Not applicable; this package has no browser UI.
