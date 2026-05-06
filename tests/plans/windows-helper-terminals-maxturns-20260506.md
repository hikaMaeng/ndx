# Windows Helper Terminals And Max Turns - 2026-05-06

## Goal

Prevent Windows helper console windows from appearing during ndx runs and make
`maxTurns` exhaustion unmistakably incomplete instead of printing partial model
text as if the task finished.

## Scope

1. Hide child process windows for managed process execution, Docker sandbox
   probes, and generated core tool runtimes.
2. Keep `maxTurns` as a warning plus completed turn, but return no final text
   when the model did not produce a final answer.
3. Suppress `model_text` events for responses that also contain tool calls.
4. Publish and Windows-install-test the patched package from Verdaccio.

## Verification

- TypeScript compile.
- Prettier check.
- Targeted agent, process, tool, and session tests.
- Full `yarn test`.
- `npm run deploy`.
- Verdaccio publish and Windows global install verification.
- Windows `F:\dev\test2` scenario confirming no visible helper terminals and a
  clear `maxTurns` warning.
