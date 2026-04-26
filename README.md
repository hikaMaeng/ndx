# ndx

> A terminal coding agent for developers who think in systems —
> built on [OpenAI Codex](https://github.com/openai/codex), shaped by [neurondev](https://www.youtube.com/@neurondev).

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Based on](https://img.shields.io/badge/based%20on-openai%2Fcodex-orange.svg)](https://github.com/openai/codex)

---

## What is ndx?

**ndx** is a fork of OpenAI Codex that goes beyond vanilla agent execution.

Codex is already a capable coding agent — it reads your codebase, reasons about tasks, and writes code in your terminal. ndx takes that foundation and extends it toward a specific vision: **a local-first, composable agent environment** where every layer of execution is inspectable, hookable, and scriptable.

The project is developed openly as part of the **neurondev** channel, where the evolution of ndx — decisions, experiments, dead ends — is documented in real time.

---

## Vision

Most AI coding tools treat the agent as a black box: input goes in, code comes out.

ndx treats the agent as infrastructure. The goal is an environment where:

- **Hooks are first-class citizens** — every meaningful agent lifecycle event (task start, tool call, file write, subtask spawn, completion) is interceptable with composable, scriptable hooks, not just post-hoc callbacks
- **Parallel agents are coordinated, not just concurrent** — spawning multiple agents to work on decomposed subtasks, with structured result aggregation and conflict resolution, not fire-and-forget parallelism
- **Local workflow is sovereign** — the agent respects and integrates with your local shell environment, editor, dotfiles, and tooling; no cloud dependency required for core functionality

These aren't features that exist yet. They're the direction.

---

## Roadmap

### Phase 1 — Foundation (current)
- Establish ndx as a standalone project based on openai/codex
- Document the upstream baseline and divergence points
- Set up development environment and contribution workflow

### Phase 2 — Hook System
- Design a structured lifecycle hook API
- Implement pre/post hooks for tool calls, file operations, and agent steps
- Enable hook composition and chaining
- Shell-scriptable hook interface for local automation

### Phase 3 — Parallel Agent Coordination
- Structured task decomposition and subtask dispatching
- Agent result aggregation with conflict detection
- Shared context and state management across parallel agents
- Dependency graph for agent subtasks

### Phase 4 — Local Convenience Layer
- Shell environment integration (env vars, aliases, local config)
- Editor integration hooks (VS Code, Neovim, JetBrains)
- Local secret and credential management
- Offline-capable planning and dry-run modes

---

## Getting Started

ndx is currently in early development. The CLI interface mirrors Codex upstream. See [USAGE.md](USAGE.md) for full build and run instructions.

```bash
# Build (requires Rust toolchain)
cargo build --release -p codex-rs

# Run
./target/release/codex
```

> API key required: set `OPENAI_API_KEY` in your environment.

---

## Status

ndx is pre-release. The codebase is currently aligned with upstream Codex.
Breaking changes from upstream may be introduced as ndx diverges.
There is no stability guarantee until v1.0.

---

## Contributing

Issues and discussions are welcome. Pull requests are accepted for bug fixes and well-scoped features.
For larger proposals, open an issue first to discuss direction.

---

## License

Apache License 2.0 — see [LICENSE](LICENSE).

This project is based on [OpenAI Codex](https://github.com/openai/codex), Copyright 2025 OpenAI.
See [NOTICE](NOTICE) for full attribution details.
