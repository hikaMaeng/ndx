# Testing

Repository-level agenttest suites under `test/YYYYMMDD` are authoritative.

Package checks:

```bash
yarn workspace @neurondev/ndx-core build
```

Agent loop refactors must also keep an agenttest suite that checks the public
`runAgent` entrypoint, submodule structure, TypeScript build, and deploy
contract. The 2026-05-08 loop split is covered by
`test/20260508/004110_agent-loop-refactor.json`.

Streaming loop changes must verify that item lifecycle, assistant delta, and
tool-call delta events are emitted before final text while preserving tool
follow-up behavior. Initial-context changes must verify that turn input carries
AGENTS.md and `<environment_context>` snapshots outside persisted chat history.
The 2026-05-08 streaming and initial-context contract is covered by
`test/20260508/153243_agent-loop-stream-events.json`.

The Rust-to-NDX loop analysis report is covered by
`test/20260508/165658_agent-loop-analysis-report.json`.

The Korean translation of the loop analysis report is covered by
`test/20260508/174826_agent-loop-analysis-ko.json`.

Sub-agent controller, built-in MCP resource tools, and bounded artifact context
behavior are covered by
`test/20260508/201728_agent-loop-subsystems.json`.

The 0.1.40 Verdaccio release and isolated install acceptance are covered by
`test/20260508/214231_publish-install-tetris.json`.

Tool execution must contain task-tool exceptions as model-visible
`function_call_output` items unless the turn is aborted. The 0.1.41
missing-MCP-resource regression is covered by
`test/20260509/013818_mcp-resource-cli-error.json`.

Browser-facing dashboard changes must preserve the root `main` landmark,
dashboard navigation names, action status semantics, and documented test ids in
root `docs/constraints.md`.
