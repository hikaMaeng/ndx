# Test Plan: model-pools

## Created

2026-04-30

## Goal

Verify that settings support legacy string `model` values plus object model
pools, and that new sessions receive `model.session` entries in round-robin
order while worker and reviewer pools remain validated placeholders.

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
2. Confirm string `model` settings normalize to a single-entry session pool.
3. Confirm object `model` settings parse `session`, `worker`, and `reviewer`
   pools and validate all referenced names against `models[]`.
4. Start multiple sessions through `SessionServer`.
5. Confirm session summaries and created model clients observe session pool
   assignment in round-robin order.

## Expected Results

- `npm test` passes.
- Legacy string model settings continue to work.
- Object model pool settings are accepted.
- Worker and reviewer pools are parsed and validated but unused by runtime
  dispatch.
- New sessions cycle through `model.session`.

## Logs To Capture

- `npm test` pass/fail output.
- TypeScript compile errors.
- Assertion failures for model pool parsing or session assignment.

## Locator Contract

No browser UI exists for this package.
