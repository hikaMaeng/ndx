# API

## CLI

```bash
ndx [--mock] [--cwd PATH] [prompt]
ndx serve [--mock] [--cwd PATH] [--listen HOST:PORT]
ndx --connect ws://HOST:PORT [--cwd PATH] [prompt]
```

`ndx` without a prompt on a TTY opens the interactive `ndx>` prompt. Normal
one-shot and interactive modes start an embedded loopback session server, then
send socket requests to it. `ndx serve` keeps the session server open for other
clients.

Interactive slash commands are session-server controls. The CLI parses the
leading slash and sends `command/execute`; command text is not appended to model
context.

| Command      | Behavior                                             |
| ------------ | ---------------------------------------------------- |
| `/help`      | Print available session-server commands.             |
| `/status`    | Print initialized server and current session status. |
| `/init`      | Print the latest session initialization event.       |
| `/events`    | Print recent runtime event types for the session.    |
| `/session`   | List saved and live sessions for the current `cwd`.  |
| `/restore`   | Switch to a session by UUID or `/session` number.    |
| `/interrupt` | Ask the server to interrupt the current session.     |
| `/exit`      | Close the CLI client.                                |

## Options

- `--mock`: use deterministic local model behavior. No network or provider key required.
- `--cwd PATH`: workspace directory used by project settings discovery and shell commands.
- `--listen HOST:PORT`: bind address for `ndx serve`. The default is `127.0.0.1:0`.
- `--connect ws://HOST:PORT`: send the prompt to an existing session server.
- `--help`: print CLI help.
- `--version`: print package version.

## Session Server API

The session server is a WebSocket JSON-RPC endpoint. It owns live session state,
event fan-out, and JSONL persistence. Clients send requests and receive
notifications; they are not authoritative session stores.

Requests:

| Method              | Params                        | Result                                    |
| ------------------- | ----------------------------- | ----------------------------------------- |
| `initialize`        | none                          | server name, protocol, methods, bootstrap |
| `command/list`      | none                          | `{ commands }`                            |
| `command/execute`   | `{ name, args?, sessionId? }` | command result                            |
| `session/start`     | `{ cwd? }`                    | `{ session }`                             |
| `session/list`      | `{ cwd? }`                    | `{ sessions }`                            |
| `session/restore`   | `{ cwd?, selector }`          | `{ session, events }`                     |
| `session/subscribe` | `{ sessionId }`               | `{ session, events }`                     |
| `session/read`      | `{ sessionId }`               | `{ session, events }`                     |
| `turn/start`        | `{ sessionId, prompt }`       | `{ turn }`                                |
| `turn/interrupt`    | `{ sessionId, reason? }`      | `{ session }`                             |

Notifications:

- `session/started`
- `session/restored`
- `session/configured`
- `turn/started`
- `item/toolCall`
- `item/toolResult`
- `item/agentMessage`
- `session/tokenUsage/updated`
- `turn/completed`
- `turn/aborted`
- `warning`
- `error`

Server JSONL records are queued by the session server and written by a child
writer process to `<globalDir>/sessions/ts-server/<sessionId>.jsonl`. Records
include `persistedAt` and `writerPid`. Empty sessions are not persisted and do
not receive workspace numbers. The first user prompt assigns the next
monotonically increasing number for that resolved `cwd`, changes the title from
`empty` to a shortened prompt prefix, and writes `session_started`.

`session/list` scans persisted JSONL files plus live server memory, filters by
the requested `cwd`, and returns workspace sequence numbers. `/session` prints
`0. new session` plus the same numbered view. `session/restore` and `/restore`
accept either the full session id or the workspace number. Restored sessions
reuse the original session id and append new records to the original JSONL file.

Restore does not yet replay prior turns into model context. The current agent
loop samples each submitted prompt independently, so restore currently means
server identity, event history, ownership, and persistence continuation.

Session ownership is tracked in a separate owner file per session. A socket
server claims ownership before processing a prompt. If another server has taken
ownership, the next prompt reloads persisted state before continuing. At turn
completion, a server also checks ownership; if ownership changed mid-turn, it
discards stale live output, reloads persisted state, and reclaims ownership.

`initialize` returns `bootstrap`, and `session/configured` includes the
same shape on `event.bootstrap`:

```json
{
  "globalDir": "/home/.ndx",
  "checkedAt": 1777440000000,
  "elements": [
    {
      "name": "settings.json",
      "path": "/home/.ndx/settings.json",
      "status": "installed"
    }
  ]
}
```

`status` is either `installed` or `existing`. The session server performs this
bootstrap check before starting session work.

## Settings

Runtime configuration is JSON only.

Load order:

1. `/home/.ndx/settings.json`
2. The nearest ancestor project file named `.ndx/settings.json`
3. `/home/.ndx/search.json` for web-search parsing and interpretation rules

Project settings override global settings. Only one project settings file is loaded.

Canonical shape:

```json
{
  "model": "qwen3.6-35b-a3b:tr",
  "providers": {
    "lmstudio": {
      "type": "openai",
      "key": "",
      "url": "http://192.168.0.6:12345/v1"
    }
  },
  "models": [
    {
      "name": "qwen3.6-35b-a3b:tr",
      "provider": "lmstudio",
      "maxContext": 262000
    }
  ],
  "permissions": {
    "defaultMode": "danger-full-access"
  },
  "websearch": {
    "provider": "tavily",
    "apiKey": ""
  },
  "mcp": {},
  "keys": {}
}
```

`providers.<name>.type` must be `openai` or `anthropic`. `openai` targets OpenAI-compatible servers and prefers the Responses API. `anthropic` targets the Messages API.

`keys` are merged into the shell tool environment. `env` is accepted as a compatibility alias but `keys` is the canonical settings field.

## Search Rules

`/home/.ndx/search.json` stores provider-specific request, response parsing, ranking, and interpretation rules. The file is loaded separately from credentials so rules can evolve without changing model/provider settings.

## Model API

The model layer exposes one provider-neutral client contract to the agent loop:

- input: user text or ordered `function_call_output` items;
- `previousResponseId` when the provider supports response chaining;
- function tool schemas from the TypeScript tool registry;
- normalized text, tool calls, usage, raw payload, and optional response id.

Adapters:

| Provider type | Primary API                     | Fallback                                                 |
| ------------- | ------------------------------- | -------------------------------------------------------- |
| `openai`      | `POST {provider.url}/responses` | `POST {provider.url}/chat/completions` on `404` or `405` |
| `anthropic`   | `POST {provider.url}/messages`  | none                                                     |

OpenAI Responses sends `model`, `instructions`, `input`,
`previous_response_id`, provider-specific `tools`, and `tool_choice = "auto"`.
The agent registry stores Chat Completions-compatible function schemas, so the
Responses adapter converts `{ type: "function", function: ... }` into the flat
Responses function tool shape before sending. Chat Completions keeps volatile
messages in memory and converts tool outputs into `role = "tool"` messages.
Anthropic Messages keeps volatile messages in memory, sends `system`,
`messages`, `max_tokens`, and tools converted to Anthropic `input_schema`.

If `provider.key` is an empty string, OpenAI-compatible requests omit `Authorization`; Anthropic requests omit `x-api-key`.

## Tool Layers

At turn startup the registry scans every layer in fixed priority order. First match wins when names collide.

| Priority | Layer          | Source path                                                   |
| -------- | -------------- | ------------------------------------------------------------- |
| 0        | task           | Agent-owned task orchestration tools only.                    |
| 1        | core           | `/home/.ndx/core/tools`                                       |
| 2        | project        | `<project>/.ndx/tools`                                        |
| 3        | global         | `/home/.ndx/tools`                                            |
| 4        | project plugin | `<project>/.ndx/plugins/<plugin>/tools`                       |
| 5        | global plugin  | `/home/.ndx/plugins/<plugin>/tools`                           |
| 6        | project MCP    | MCP servers declared by nearest project `.ndx/settings.json`. |
| 7        | global MCP     | MCP servers declared by `/home/.ndx/settings.json`.           |

Only task orchestration tools are agent-owned: `update_plan`, `request_user_input`, multi-agent task tools, and agent-job task tools. Shell, filesystem, patch, web, media, plugin, and other capability tools must be external `tool.json` packages.

Startup bootstraps the built-in core capability packages under `/home/.ndx/core/tools`: `shell`, `apply_patch`, `list_dir`, `view_image`, `web_search`, `image_generation`, `tool_suggest`, `tool_search`, and `request_permissions`.

## `tool.json`

Every filesystem tool is a directory whose folder name equals `function.name` and contains `tool.json`.

```json
{
  "type": "function",
  "function": {
    "name": "shell",
    "description": "Run a shell command.",
    "parameters": {
      "type": "object",
      "properties": {
        "command": { "type": "string" }
      },
      "required": ["command"],
      "additionalProperties": false
    }
  },
  "command": "node",
  "args": ["tool.mjs"],
  "cwd": ".",
  "env": {}
}
```

Execution fields use the same command shape as stdio MCP configuration: `command`, optional `args`, optional `cwd`, optional `env`, and optional `timeoutMs`. The tool process receives a JSON request on stdin:

```json
{ "arguments": {}, "cwd": "/workspace" }
```

The same arguments are also available through `NDX_TOOL_ARGS`; the agent cwd is available through `NDX_TOOL_CWD`.

## MCP Tools

Project MCP tools are discovered before global MCP tools. Static `tools[]` declarations are accepted, and command-backed MCP servers are queried with `tools/list` during startup. MCP tool calls run through an isolated worker process and then through the configured MCP stdio command.

## Tool Execution

Every model tool call is scheduled asynchronously through an isolated Node worker process. A model response containing multiple tool calls runs those workers in parallel. A sequential workflow is represented by later model turns, not by synchronous in-process execution.

Process spawning and nested serial/parallel task plans are implemented in `src/process/`. The process library has no ndx package dependencies and can be instantiated multiple times; the session tool runner is only one consumer.
