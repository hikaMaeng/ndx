# Overview

`codex-process` provides reusable runtime primitives for:

- spawning external processes
- streaming process output events
- cancelling one process or all processes owned by a manager
- running task plans composed from serial and parallel nodes
- registering cancellation hooks on task implementations

The crate is a library only. It does not own protocols, UI, transport, sandbox
policy, or tool-specific behavior.
