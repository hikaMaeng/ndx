# Test Plan: session-bootstrap

## Created

2026-04-29

## Goal

Verify that required global `.ndx` elements are installed during config loading
and re-checked by the session server before session work starts, and that
bootstrap detail is sent to socket clients.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Shell: bash
- Runtime: Node.js 22+ through `npm test`

## Preconditions

- Dependencies are installed.
- Tests use temporary `.ndx` directories.
- No provider key is required; session tests use `MockModelClient`.

## Steps

1. Run `npm test`.
2. Verify `ensureGlobalNdxHome()` creates missing `system/tools`, shell tool files, and `system/skills` without generating `settings.json`.
3. Verify a second bootstrap run reports required elements as `existing`.
4. Start `SessionServer` with a temporary global `.ndx`.
5. Send `initialize` and assert the response includes bootstrap detail.
6. Start a thread and assert `thread/sessionConfigured` includes the same bootstrap shape.
7. Execute `/init` through `command/execute` and assert bootstrap detail is visible.

## Expected Results

- Missing required `.ndx` elements are installed before session work.
- Bootstrap reports distinguish `installed` from `existing`.
- Socket clients receive bootstrap detail through `initialize`.
- Runtime session initialization events include bootstrap detail without adding it to prompt context.

## Logs To Capture

- `npm test` pass/fail output.
- TypeScript compile errors.
- Assertion failures naming missing bootstrap elements.

## Locator Contract

No browser UI exists for this package.
