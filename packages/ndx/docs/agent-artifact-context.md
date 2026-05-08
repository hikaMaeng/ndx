# Agent Artifact Context

This note records how historical Codex Rust decides which resources become
model-visible context, and how NDX mirrors that boundary.

## Rust Evidence

| Question                        | Rust evidence                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Structured user resources       | `codex-rs/protocol/src/user_input.rs`                                                                            |
| User input to Responses content | `codex-rs/protocol/src/models.rs`                                                                                |
| Explicit app/plugin mentions    | `codex-rs/core/src/plugins/mentions.rs`                                                                          |
| Contextual injected fragments   | `codex-rs/core/src/context/fragment.rs`, `codex-rs/core/src/context/mod.rs`                                      |
| Turn context and settings diffs | `codex-rs/core/src/context_manager/updates.rs`, `codex-rs/core/src/session/turn.rs`                              |
| UI thread item reconstruction   | `codex-rs/app-server-protocol/src/protocol/thread_history.rs`, `codex-rs/app-server-protocol/src/protocol/v2.rs` |
| MCP resource reads              | `codex-rs/core/src/session/mcp.rs`, `codex-rs/app-server/src/codex_message_processor.rs`                         |

## Boundary

Codex Rust does not treat every UI artifact as automatic prompt context. The
model-visible path is explicit:

- `UserInput::Text`, `Image`, and `LocalImage` become message content.
- `UserInput::Skill` and `UserInput::Mention` are markers; their bodies or
  capabilities are injected later by core logic, not by serializing the marker
  itself.
- `ContextualUserFragment` implementations add AGENTS.md, environment,
  permissions, skills, apps, hook context, sub-agent notices, and similar
  runtime fragments.
- MCP resources are read through explicit `mcpServer/resource/read` requests or
  MCP tool/resource paths. Listing resources does not itself inject contents.
- App-server `ThreadItem` variants reconstruct renderable UI history such as
  messages, command executions, file changes, MCP calls, image views, image
  generation, and collaboration tool calls. Those are UI/history artifacts, not
  a blanket rule for future prompt inclusion.

## NDX Contract

NDX follows the same conservative boundary. The agent loop only creates an
artifact context message for concrete local files that are already referenced in
model-visible history or in the current prompt. A candidate must resolve under
the active `cwd`, exist as a file, and fit the bounded artifact list.

Text-like files get a short excerpt. Other files get path, size, and timestamp
metadata only. This prevents a UI artifact list, stale side-panel entry, or
remote URI from silently becoming prompt content.

The implementation lives in `src/agent/loop/artifacts.ts` and is inserted by
`src/agent/loop/state.ts` before the user prompt. MCP resource discovery remains
explicit through `list_mcp_resources`, `list_mcp_resource_templates`, and
`read_mcp_resource`.
