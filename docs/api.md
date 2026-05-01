# API

## CLI

```bash
ndx [SERVER_ADDRESS]
ndx serve [--mock] [--cwd PATH] [--listen HOST:PORT] [--dashboard-listen HOST:PORT]
ndxserver [--mock] [--cwd PATH] [--listen HOST:PORT] [--dashboard-listen HOST:PORT]
ndx --connect ws://HOST:PORT [--cwd PATH] [prompt]
ndx --mock [--cwd PATH] [prompt]
```

`ndx` is the host CLI. Its only startup argument is `SERVER_ADDRESS`, which
defaults to `127.0.0.1:45123`. The CLI connects to that server first. If no
server is reachable, it reports the miss, asks for a workspace folder, starts a
local default server at `127.0.0.1:45123`, logs in over the socket, asks for a
project under the workspace, and then shows session choices. Docker is only the
tool sandbox. `--mock` keeps the source-tree development path and starts an
embedded loopback server. `ndx serve` and `ndxserver` keep the session server
open for other clients.

Interactive slash commands are session-server controls. The CLI parses the
leading slash and sends `command/execute`; command text is not appended to model
context.

| Command           | Behavior                                             |
| ----------------- | ---------------------------------------------------- |
| `/help`           | Print available session-server commands.             |
| `/status`         | Print initialized server and current session status. |
| `/init`           | Print the latest session initialization event.       |
| `/events`         | Print recent runtime event types for the session.    |
| `/login`          | Choose Google, GitHub, current, or default user.     |
| `/session`        | List saved and live sessions for the current `cwd`.  |
| `/restoreSession` | Switch to a session by UUID or `/session` number.    |
| `/deleteSession`  | Delete another session for the current `cwd`.        |
| `/interrupt`      | Ask the server to interrupt the current session.     |
| `/exit`           | Close the CLI client.                                |

## Options

- `--mock`: use deterministic local model behavior. No network or provider key required.
- `--cwd PATH`: server or mock-mode working directory used by project settings discovery and shell commands.
- `--listen HOST:PORT`: bind address for `ndx serve`. The default is `127.0.0.1:0`.
- `--dashboard-listen HOST:PORT`: bind address for the dashboard HTTP listener in server mode. The default is `127.0.0.1:0`.
- `--connect ws://HOST:PORT`: send the prompt to an existing session server.
- `--help`: print CLI help.
- `--version`: print package version.

## Session Server API

The session server is a WebSocket JSON-RPC endpoint. It owns live session state,
event fan-out, and SQLite persistence. Clients send requests and receive
notifications; they are not authoritative session stores.
The server also starts a separate HTTP dashboard listener. Socket methods other
than `account/create`, `account/login`, and `account/socialLogin` require
successful account login on that WebSocket connection. Unauthenticated
non-login methods are ignored.

Requests:

| Method                     | Params                                                          | Result                                                   |
| -------------------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| `initialize`               | none                                                            | server name, protocol, methods, bootstrap                |
| `command/list`             | none                                                            | `{ commands }`                                           |
| `account/create`           | `{ username, password? }`                                       | `{ username, createdAt }`                                |
| `account/login`            | `{ username?, password?, clientId? }`                           | `{ username, clientId, sessionRoot }`                    |
| `account/socialLogin`      | `{ provider, subject?, accessToken, refreshToken?, clientId? }` | `{ username, clientId, sessionRoot, provider, created }` |
| `account/delete`           | `{ username }`                                                  | `{ username, deleted }`                                  |
| `account/changePassword`   | `{ username, oldPassword?, newPassword }`                       | `{ username, updatedAt }`                                |
| `project/list`             | none                                                            | `{ root, projects }`                                     |
| `project/create`           | `{ name }`                                                      | `{ project }`                                            |
| `command/execute`          | `{ name, args?, sessionId?, user?, clientId? }`                 | command result                                           |
| `session/start`            | `{ cwd?, user?, clientId? }`                                    | `{ session }`                                            |
| `session/list`             | `{ cwd?, user?, clientId? }`                                    | `{ sessions }`                                           |
| `session/restore`          | `{ cwd?, selector, user?, clientId? }`                          | `{ session, events }`                                    |
| `session/deleteCandidates` | `{ cwd?, currentSessionId?, user?, clientId? }`                 | `{ sessions }`                                           |
| `session/delete`           | `{ cwd?, selector, currentSessionId?, user?, clientId? }`       | `{ session, message }`                                   |
| `session/subscribe`        | `{ sessionId, user?, clientId? }`                               | `{ session, events }`                                    |
| `session/read`             | `{ sessionId }`                                                 | `{ session, events }`                                    |
| `turn/start`               | `{ sessionId, prompt, user?, clientId? }`                       | `{ turn }`                                               |
| `turn/interrupt`           | `{ sessionId, reason? }`                                        | `{ session }`                                            |

Notifications:

- `session/started`
- `session/restored`
- `session/deleted`
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

Server records are stored in `<dataDir>/ndx.sqlite`. The default data directory
is `/home/.ndx/system`; settings may define `dataPath`, and legacy `sessionPath`
is treated as a data-directory override. Social login validates the access token
against the provider profile endpoint, uses `provider:subject` as the server
`userId`, creates the account on first login, and reuses it on later logins.
Empty sessions are not persisted and do not receive workspace numbers. The first user prompt assigns the next
monotonically increasing number for that resolved `cwd`, changes the title from
`empty` to a shortened prompt prefix, and stores `session_started`.

`session/list` scans SQLite records plus live server memory, filters by
the requested user and `cwd`, and returns workspace sequence numbers. If no
user is supplied, `defaultUser` is used. `/session` prints `0. new session`
plus the same numbered view. `session/restore` and
`/restoreSession` accept either the full session id or the workspace number.
Restored sessions reuse the original session id and append new records to the
same SQLite session. `/deleteSession` lists sessions for the same `cwd`, omits
the current session, accepts Enter as cancel, and marks the selected session
deleted.

Restore also replays prior turns into model context. Runtime events are
converted back into provider-facing conversation items: `turn_started` becomes a
user message, `agent_message` and `turn_complete` become assistant messages,
and prior `tool_call`/`tool_result` pairs are restored with stable synthetic
call ids.

Session ownership is tracked in SQLite. A socket server claims ownership before
processing a prompt. If another server has taken
ownership, the next prompt reloads persisted state before continuing. At turn
completion, a server also checks ownership; if ownership changed mid-turn, it
discards stale live output, reloads persisted state, and reclaims ownership.
If the SQLite session was marked deleted by another server, the stale owner
sends `session/deleted`, closes its sockets, and terminates the server.

## Host CLI App State

The host CLI stores user-interface state outside agent `.ndx` configuration.
`NDX_CLI_STATE_DIR` overrides the directory. Without the override, Windows uses
`LOCALAPPDATA/ndx`, Unix-like systems use `XDG_STATE_HOME/ndx` when set, and
otherwise `~/.local/state/ndx`.

Files:

| File        | Purpose                                                    |
| ----------- | ---------------------------------------------------------- |
| `auth.json` | Single shared last-login value for all host CLI instances. |

The last-login value is independent from `clientId`. Each CLI process still
creates its own runtime `clientId`; the stored login only chooses the `userId`.

The host CLI no longer generates Docker compose files for the server. If the
requested server is unavailable, it starts a local server process. The server
itself creates or reuses a per-workspace Docker sandbox container for
shell-like tools.

HTTP `GET /` and `GET /dashboard` on the dashboard port return a minimal
dashboard placeholder. The dashboard has no authentication or authorization.
The agent service remains socket-first; this page is only an admin UI anchor
until a real dashboard is implemented.

`initialize` returns `bootstrap`, and `session/configured` includes the
same shape on `event.bootstrap`:

```json
{
  "globalDir": "/home/.ndx",
  "checkedAt": 1777440000000,
  "elements": [
    {
      "name": "system/core",
      "path": "/home/.ndx/system/core",
      "status": "installed"
    }
  ]
}
```

`status` is either `installed` or `existing`. Settings files are not included in
the bootstrap report because startup never generates them. The session server
performs this bootstrap check before starting session work.

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
  "model": {
    "session": ["local-main-a", "local-main-b"],
    "worker": ["local-worker-a", "local-worker-b"],
    "reviewer": ["local-review-a"],
    "custom": {
      "deep": ["local-review-a", "local-review-b"],
      "fast": "local-main-a"
    }
  },
  "dataPath": "/mnt/state/ndx-data",
  "providers": {
    "local-openai-a": {
      "type": "openai",
      "key": "",
      "url": "http://127.0.0.1:12345/v1"
    },
    "local-openai-b": {
      "type": "openai",
      "key": "",
      "url": "http://127.0.0.1:12346/v1"
    }
  },
  "models": {
    "local-main-a": {
      "name": "local-model-a",
      "provider": "local-openai-a",
      "maxContext": 262000,
      "effort": ["low", "medium", "high"],
      "think": true
    },
    "local-main-b": {
      "name": "local-model-b",
      "provider": "local-openai-b",
      "maxContext": 262000,
      "effort": ["high"],
      "think": true,
      "limitResponseLength": 4096
    }
  },
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

`model` may also be a single string for compatibility. A string is normalized to
`model.session = [value]`. Pool entries reference model IDs. Legacy `models[]`
entries use `name` as the ID; object `models` entries use the object key as the
ID and `name` as the provider-facing model name. The router binds a live session
to one model per selected pool, preserving prefix-cache locality until an
explicit model, effort, thinking, or pool change.

Optional model fields are `maxContext`, `effort`, `think`,
`limitResponseLength`, `topK`, `repeatPenalty`, `presencePenalty`, `topP`, and
`MinP`. `effort` is the complete supported list for that model ID. `think`
declares that the model supports live thinking-mode toggles. Unsupported fields
cannot be changed with `/model`.

`providers.<name>.type` must be `openai` or `anthropic`. `openai` targets OpenAI-compatible servers and prefers the Responses API. `anthropic` targets the Messages API.

`keys` are merged into the shell tool environment. `env` is accepted as a compatibility alias but `keys` is the canonical settings field.

## Search Rules

`/home/.ndx/search.json` stores provider-specific request, response parsing, ranking, and interpretation rules. The file is loaded separately from credentials so rules can evolve without changing model/provider settings.

## Model API

The model layer exposes one provider-neutral client contract to the agent loop:

- input: user text or ordered `function_call_output` items;
- function tool schemas from the TypeScript tool registry;
- normalized text, tool calls, usage, raw payload, and optional response id.

Adapters:

| Provider type | Primary API                     | Fallback                                                 |
| ------------- | ------------------------------- | -------------------------------------------------------- |
| `openai`      | `POST {provider.url}/responses` | `POST {provider.url}/chat/completions` on `404` or `405` |
| `anthropic`   | `POST {provider.url}/messages`  | none                                                     |

OpenAI Responses sends `model`, `instructions`, full client-side `input`,
provider-specific `tools`, and `tool_choice = "auto"`. It does not send
`previous_response_id`.
The agent registry stores Chat Completions-compatible function schemas, so the
Responses adapter converts `{ type: "function", function: ... }` into the flat
Responses function tool shape before sending. Chat Completions receives the
same client-side stack converted to `messages` and maps tool outputs into
`role = "tool"` messages. Anthropic Messages receives the same client-side
stack converted to Anthropic `messages`, sends `system`, `max_tokens`, and
tools converted to Anthropic `input_schema`.

If `provider.key` is an empty string, OpenAI-compatible requests omit `Authorization`; Anthropic requests omit `x-api-key`.

## Tool Layers

At turn startup the registry scans every layer in fixed priority order. First match wins when names collide.

| Priority | Layer          | Source path                                                   |
| -------- | -------------- | ------------------------------------------------------------- |
| 0        | task           | Agent-owned task orchestration tools only.                    |
| 1        | core           | `/home/.ndx/system/core/tools`                                |
| 2        | project        | `<project>/.ndx/tools`                                        |
| 3        | global         | `/home/.ndx/tools`                                            |
| 4        | project plugin | `<project>/.ndx/plugins/<plugin>/tools`                       |
| 5        | global plugin  | `/home/.ndx/plugins/<plugin>/tools`                           |
| 6        | project MCP    | MCP servers declared by nearest project `.ndx/settings.json`. |
| 7        | global MCP     | MCP servers declared by `/home/.ndx/settings.json`.           |

Only task orchestration tools are agent-owned: `update_plan`, `request_user_input`, multi-agent task tools, and agent-job task tools. Shell, filesystem, patch, web, media, plugin, and other capability tools must be external `tool.json` packages.

Startup bootstraps the built-in core capability packages under `/home/.ndx/system/core/tools`: `shell`, `apply_patch`, `list_dir`, `view_image`, `web_search`, `image_generation`, `tool_suggest`, `tool_search`, and `request_permissions`.

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
