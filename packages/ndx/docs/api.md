# API

Package exports:

| Export                          | Contract                                         |
| ------------------------------- | ------------------------------------------------ |
| `@neurondev/ndx-core`           | Root helpers for app integration.                |
| `@neurondev/ndx-core/cli`       | `main()` CLI entrypoint.                         |
| `@neurondev/ndx-core/server`    | `SessionServer` and server option/address types. |
| `@neurondev/ndx-core/dashboard` | `renderDashboardHtml`.                           |
| `@neurondev/ndx-core/shared`    | Runtime protocol and shared type contracts.      |

The install-facing bins stay in `apps/ndx`, not this package.

## Runtime Events

Agent turns separate final return value from in-turn progress events.

| Event                       | Contract                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `item_started`              | A model-visible item began, such as assistant message or function call.                          |
| `agent_message_delta`       | Incremental assistant text for an active message item. Not persisted as final history by itself. |
| `tool_call_delta`           | Incremental function-call argument text for an active tool-call item.                            |
| `item_completed`            | A model-visible item ended.                                                                      |
| `agent_message`             | Final assistant text for compatibility and history persistence.                                  |
| `tool_call` / `tool_result` | Tool execution request and result used for follow-up model input.                                |
| `turn_complete`             | Turn lifecycle completion with final text.                                                       |

`ModelClient.stream` is optional. When present, the agent loop consumes
provider stream events directly; otherwise the loop adapts a completed
`ModelResponse` into the same item lifecycle shape.

## Built-In Tools

The task tool layer includes `update_plan`, `request_user_input`, skill tools,
collaboration tools, agent-job tools, and explicit MCP resource tools:
`list_mcp_resources`, `list_mcp_resource_templates`, and `read_mcp_resource`.

Collaboration tools use the shared sub-agent controller when `ToolContext`
provides one. Without a controller they return an unavailable status instead of
silently pretending work was scheduled.

## Turn Context Input

`runAgent` builds a per-turn input snapshot before the user prompt. The snapshot
contains AGENTS.md instructions read from the configured context sources and an
`<environment_context>` block with current `cwd`, shell, date, timezone,
permission mode, and ndx runtime paths. This mirrors Codex Rust's separation
between API-level base instructions and input-level contextual user fragments.

If prior model-visible text or the current prompt references existing local
files under the active `cwd`, the loop adds a bounded `# Referenced Artifacts`
context message before the prompt. See `docs/agent-artifact-context.md`.
