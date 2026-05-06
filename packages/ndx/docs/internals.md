# Internals

The package is the domain boundary for ndx. `SessionServer` wires model clients,
Docker sandbox state, SQLite persistence, dashboard HTTP, and `AgentRuntime`.
`AgentRuntime` emits protocol events and calls an injected agent runner.
`runAgent` owns provider follow-up, tool-call execution, skill injection, and
max-turn enforcement.

Tool workers execute as child Node processes. External tools and MCP stdio
commands use Docker when the server provides `NDX_SANDBOX_CONTAINER`.

