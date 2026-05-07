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

Browser-facing dashboard changes must preserve the root `main` landmark,
dashboard navigation names, action status semantics, and documented test ids in
root `docs/constraints.md`.
