# Test Plan: tool-orchestration

## Created

2026-04-29

## Goal

Verify the TypeScript agent tool system across four required surfaces:

1. A model-driven run uses every tool exposed by the configured registry.
2. Parallel tool calls in the same model response overlap, while serial work
   across model responses happens in response order.
3. Agent tool calls are isolated through worker/external child processes.
4. Each configured tool can be directly executed without going through the
   agent loop.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Shell: bash
- Runtime: local Node/npm
- Container verification: repository `npm run deploy`

## Preconditions

- Dependencies are installed.
- Docker is available for deploy verification.
- Test fixtures may create temporary external tools and an MCP server under the
  OS temp directory.

## Steps

1. Add a focused integration test file for tool orchestration.
2. In the model-driven test, build a registry with task tools, external
   `tool.json` tools, and an MCP tool.
3. Use a scripted model client that emits every registry tool name as a tool
   call at least once.
4. Assert the emitted `tool_call` events cover every expected tool.
5. Assert parallel external tool timestamps overlap.
6. Assert serial external tool timestamps remain ordered across model turns.
7. Assert worker/external process identifiers prove process isolation.
8. Directly execute each expected tool through `registry.execute` and validate
   expected output or expected unavailable contract.
9. Run `npm test`.
10. Run `npm run deploy`.

## Expected Results

- `npm test` passes.
- The model-driven test records every expected tool name as used.
- Parallel tool log entries overlap in time and have distinct process parents.
- Serial tool log entries occur after the parallel batch and in model-turn order.
- Direct tool execution succeeds for implemented tools and returns the documented
  unavailable payload for TypeScript placeholder tools.
- `npm run deploy` completes the build, Compose refresh, container tests, mock
  command, and Compose cleanup.

## Logs To Capture

- `npm test` summary.
- `npm run deploy` summary.
- Tool names covered by the model-driven test.
- Parallel/serial/process-isolation observations.
- Any failures or uncovered risks.

## Locator Contract

Not applicable. This change has no browser-rendered UI.
