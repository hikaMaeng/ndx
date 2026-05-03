# Slash Commands

Slash commands are session-server commands. They are parsed by a client, sent to the
server with `command/execute`, and do not become model prompt text unless a command
handler explicitly starts a turn.

## Source Baseline

The command registry is owned by the ndx TypeScript session server.
`/help` is an ndx TypeScript session command.

| Command                  | Origin description                                                     | Target placement |
| ------------------------ | ---------------------------------------------------------------------- | ---------------- |
| `/help`                  | show session-server slash commands                                     | session built-in |
| `/session`               | list sessions for the current workspace                                | session built-in |
| `/restoreSession`        | restore a saved session by id or list number                           | session built-in |
| `/deleteSession`         | delete another saved session for the current workspace                 | session built-in |
| `/model`                 | choose the active session model by number or ID                        | session built-in |
| `/effort`                | choose the active model effort by number or value                      | session built-in |
| `/think`                 | choose active model thinking mode by number or value                   | session built-in |
| `/lite`                  | toggle lite context mode                                               | session built-in |
| `/fast`                  | toggle Fast mode to enable fastest inference with increased plan usage | session built-in |
| `/approvals`             | choose what Codex is allowed to do                                     | session built-in |
| `/permissions`           | choose what Codex is allowed to do                                     | session built-in |
| `/setup-default-sandbox` | set up elevated agent sandbox                                          | session built-in |
| `/sandbox-add-read-dir`  | let sandbox read a directory                                           | session built-in |
| `/experimental`          | toggle experimental features                                           | session built-in |
| `/memories`              | configure memory use and generation                                    | session built-in |
| `/skills`                | use skills to improve how Codex performs specific tasks                | core candidate   |
| `/review`                | review my current changes and find issues                              | session built-in |
| `/rename`                | rename the current thread                                              | session built-in |
| `/new`                   | start a new chat during a conversation                                 | session built-in |
| `/resume`                | resume a saved chat                                                    | session built-in |
| `/fork`                  | fork the current chat                                                  | session built-in |
| `/init`                  | create an AGENTS.md file with instructions for Codex                   | core candidate   |
| `/compact`               | summarize conversation to prevent hitting the context limit            | session built-in |
| `/plan`                  | switch to Plan mode                                                    | session built-in |
| `/goal`                  | set or view the goal for a long-running task                           | session built-in |
| `/collab`                | change collaboration mode                                              | session built-in |
| `/agent`                 | switch the active agent thread                                         | session built-in |
| `/side`                  | start a side conversation in an ephemeral fork                         | session built-in |
| `/copy`                  | copy last response as markdown                                         | core candidate   |
| `/diff`                  | show git diff, including untracked files                               | core candidate   |
| `/mention`               | mention a file                                                         | core candidate   |
| `/status`                | show current session configuration and token usage                     | core candidate   |
| `/debug-config`          | show config layers and requirement sources for debugging               | session built-in |
| `/title`                 | configure terminal title items                                         | session built-in |
| `/statusline`            | configure status line items                                            | session built-in |
| `/theme`                 | choose a syntax highlighting theme                                     | session built-in |
| `/mcp`                   | list configured MCP tools                                              | core candidate   |
| `/apps`                  | manage apps                                                            | core candidate   |
| `/plugins`               | browse plugins                                                         | core candidate   |
| `/logout`                | log out of Codex                                                       | session built-in |
| `/quit`                  | exit Codex                                                             | session built-in |
| `/exit`                  | alias of `/quit`                                                       | session built-in |
| `/feedback`              | send logs to maintainers                                               | session built-in |
| `/rollout`               | print the rollout file path                                            | session built-in |
| `/ps`                    | list background terminals                                              | core candidate   |
| `/stop`                  | stop all background terminals                                          | core candidate   |
| `/clean`                 | alias of `/stop`                                                       | core candidate   |
| `/clear`                 | clear the terminal and start a new chat                                | session built-in |
| `/personality`           | choose a communication style for Codex                                 | session built-in |
| `/realtime`              | toggle realtime voice mode                                             | session built-in |
| `/settings`              | configure realtime microphone/speaker                                  | session built-in |
| `/test-approval`         | test approval request                                                  | session built-in |
| `/subagents`             | switch the active agent thread                                         | session built-in |
| `/debug-m-drop`          | memory maintenance debug command                                       | session built-in |
| `/debug-m-update`        | memory maintenance debug command                                       | session built-in |

## Implemented Session Commands

`/model` prints the active model ID, provider-facing model name, provider,
effort, thinking mode, and the configured model catalog for the current live
session. Session models are numbered and may be selected with the displayed
number or by local model ID.

```text
/model
/model <number|model-id>
/model effort <value|number>
/model think <on|off|1|2>
/model <number|model-id> effort <value|number> think <on|off|1|2>
/effort
/effort <number|value>
/think
/think <1|2|on|off>
```

`/effort` is accepted only when the active model declares an `effort` array.
If no effort has been chosen for a model, the default is the middle entry in the
array. `/think` is accepted only when the active model declares `think`; the
default is on. Changing the model resets effort and thinking mode to those
defaults. Unsupported `/effort` and `/think` calls print that the active model
does not support the requested control.

`/lite on` enables lightweight model context for the current saved session.
All events remain in SQLite, but completed prior turns omit `tool_call` and
`tool_result` records when the next model request is built. The active turn's
tool follow-up context is not filtered. `/lite off` attempts to restore full
context after the last compact point; if the estimated context would exceed the
active model's `maxContext`, the command leaves lite mode enabled.

```text
/lite on
/lite off
```

`/compact` writes a `context_compact` record containing a pure user/assistant
summary of prior turns. It excludes tool records and initialization/skill
loading detail. Future model context starts with that compact summary, then
continues with events recorded after the compact point. A later compact replaces
the earlier compact point for future context calculation. Lite mode, when on,
is applied only after the latest compact point.

## Discovery Layers

Command names are directory names. Each directory must contain `command.json`.
Earlier layers win on name collision.

| Priority | Layer                  | Path                                       |
| -------- | ---------------------- | ------------------------------------------ |
| 0        | session built-in       | `src/session/commands`                     |
| 1        | global core built-in   | `/home/.ndx/core/commands`                 |
| 2        | project install        | `<project>/.ndx/commands`                  |
| 3        | project plugin install | `<project>/.ndx/plugins/<plugin>/commands` |
| 4        | global install         | `/home/.ndx/commands`                      |
| 5        | global plugin install  | `/home/.ndx/plugins/<plugin>/commands`     |

## `command.json`

Minimum filesystem command shape:

```json
{
  "name": "diff",
  "description": "show git diff, including untracked files",
  "placement": "core",
  "entrypoint": {
    "command": "node",
    "args": ["command.mjs"]
  }
}
```

External command handlers receive structured session command input and return a
structured command result. They may request server capabilities through explicit
session-server bridges; they should not assume direct access to live turn state.

## Current TypeScript Implementation

`src/session/commands/registry.ts` stores command metadata. The session
server exposes:

- `command/list`: returns the known slash command definitions.
- `command/execute`: executes implemented server commands.

Implemented now:

- `/help`
- `/status`
- `/init`
- `/events`
- `/lite`
- `/compact`
- `/session`
- `/restoreSession`
- `/deleteSession`
- `/interrupt`
- `/quit`
- `/exit`

Unimplemented registered commands return an explicit "registered but not
implemented" result instead of being sent to the model.
