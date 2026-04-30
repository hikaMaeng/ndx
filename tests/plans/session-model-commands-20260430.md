# Test Plan: session-model-commands

## Created

2026-04-30

## Goal

Verify session-server built-in `/model`, `/effort`, and `/think` commands expose numbered selection and apply model runtime defaults.

## Environment

- Host: local ndx TypeScript workspace
- Commands: `npm test`, `npm run deploy`
- Deploy target: Docker Compose `ndx-agent`

## Preconditions

- Dependencies are installed.
- Feature branch is pushed before `npm run deploy`, because deploy builds from the pushed Git ref.
- Test settings include one unsupported model and one model with `effort` plus `think`.

## Steps

1. Run focused session-server and config tests through `npm test`.
2. Start a session with multiple session models.
3. Execute `/model` with model IDs and numbered selections.
4. Execute `/effort` with no args and with numbered selection.
5. Execute `/think` with no args and with numbered selection.
6. Switch to a model without `effort` or `think` and execute `/effort` and `/think`.
7. Push the branch and run `npm run deploy`.

## Expected Results

- `/model` lists numbered session models and accepts numbers or IDs.
- Model changes reset supported effort to the middle configured value and thinking mode to on.
- `/effort` lists choices and accepts numbers or values only for supported models.
- `/think` lists on/off choices and accepts `1`, `2`, `on`, or `off` only for supported models.
- Unsupported active models return an unsupported-model message instead of forwarding command text to the model.
- `npm run deploy` completes build, Docker Compose refresh, in-container tests, and smoke verification.

## Logs To Capture

- `npm test` output
- `npm run deploy` output, including compose refresh and in-container verification
- Git branch, commit, and push identifiers

## Locator Contract

No browser UI is rendered by these commands. Verification uses JSON-RPC `command/execute` responses and visible CLI command text.
