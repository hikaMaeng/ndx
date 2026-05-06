# Testing

Repository-level agenttest suites under `test/YYYYMMDD` are authoritative.

Package checks:

```bash
yarn workspace @neurondev/ndx-core build
```

Browser-facing dashboard changes must preserve the root `main` landmark,
dashboard navigation names, action status semantics, and documented test ids in
root `docs/constraints.md`.
