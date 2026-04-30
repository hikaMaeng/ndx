# Test Plan: model-affinity-options

## Goal

Verify model routing preserves prefix-cache locality and that model catalog
aliases, effort, thinking mode, and request parameters are represented in
runtime behavior.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Shell: bash
- Runtime: Node and npm from repository environment

## Preconditions

- Dependencies are installed.
- Settings tests may create temporary `.ndx` roots under the OS temp directory.
- No external model provider is required.

## Steps

1. Run `npm test`.
2. Confirm config loader accepts legacy `models[]` and object `models` catalogs.
3. Confirm router binds repeated session-pool requests to one model and keeps
   `@custom` pool follow-up requests on the selected custom binding.
4. Confirm OpenAI-compatible request options include effort, thinking, response
   length, and sampling parameters when configured.
5. Confirm `/model` can switch model ID, effort, and thinking mode and that
   `/status` reflects the live session state.

## Expected Results

- TypeScript build passes.
- Node test suite passes.
- No external provider calls are made.
- Model routing no longer rotates every provider request inside a live session.
