Shared library for process lifecycle management and hierarchical task queues.

| Goal | File |
|------|------|
| Understand purpose | [docs/overview.md](docs/overview.md) |
| Architecture | [docs/architecture.md](docs/architecture.md) |
| API reference | [docs/api.md](docs/api.md) |
| Usage | [docs/usage.md](docs/usage.md) |
| Constraints | [docs/constraints.md](docs/constraints.md) |
| Internals | [docs/internals.md](docs/internals.md) |
| Testing | [docs/testing.md](docs/testing.md) |

`codex-process` owns shared primitives for external processes and independent
task queue instances. It intentionally avoids dependencies on other `codex-*`
crates so tools, servers, and UI surfaces can share it without circular package
coupling.
