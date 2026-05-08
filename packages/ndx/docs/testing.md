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

Browser-facing dashboard changes must preserve the root `main` landmark,
dashboard navigation names, action status semantics, and documented test ids in
root `docs/constraints.md`.
