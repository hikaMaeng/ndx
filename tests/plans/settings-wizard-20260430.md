# Test Plan: settings-wizard

## Created

2026-04-30

## Goal

Verify that first-run TTY setup can create project `.ndx/settings.json` from
minimal answers when neither global nor project settings exist, while the config
loader itself still fails without falling back to a built-in model.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Shell: bash
- Runtime: Node.js through `npm test`

## Preconditions

- Dependencies are installed.
- Tests use temporary project and global directories.
- No external provider key is required.

## Steps

1. Run `npm test`.
2. Confirm `loadConfig` still throws when no settings file exists.
3. Run the settings wizard with answers for permission, provider type, empty key,
   URL, model name, and context size.
4. Confirm the wizard writes project `.ndx/settings.json`.
5. Confirm `loadConfig` can read the generated settings.

## Expected Results

- `npm test` passes.
- Generated settings use the selected permission mode.
- Empty provider key is preserved.
- Provider type, URL, model name, and max context are written.
- The loaded active model and provider match the generated settings.

## Logs To Capture

- `npm test` pass/fail output.
- TypeScript compile errors.
- Assertion failures for generated settings content.

## Locator Contract

No browser UI exists for this package.
