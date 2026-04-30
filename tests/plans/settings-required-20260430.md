# Test Plan: settings-required

## Created

2026-04-30

## Goal

Verify that ndx model/provider selection comes only from real settings files and
does not fall back to a built-in default model when both global and project
settings are absent.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Shell: bash
- Runtime: Node.js through `npm test`

## Preconditions

- Dependencies are installed.
- Tests use temporary global and project directories.
- No external provider key is required.

## Steps

1. Run `npm test`.
2. Confirm config loading still merges global settings before nearest project
   settings.
3. Confirm config loading throws when neither `/home/.ndx/settings.json` nor a
   project `.ndx/settings.json` exists.
4. Confirm bootstrap creates core directories and built-in tool packages without
   generating `settings.json`.
5. Confirm session server bootstrap reports required directories and tools
   without depending on generated settings.

## Expected Results

- `npm test` passes.
- The active model resolves from settings file content.
- Missing settings fail before model selection.
- No bootstrap path writes a default `settings.json`.

## Logs To Capture

- `npm test` pass/fail output.
- TypeScript compile errors.
- Assertion failures mentioning settings fallback or bootstrap output.

## Locator Contract

No browser UI exists for this package.
