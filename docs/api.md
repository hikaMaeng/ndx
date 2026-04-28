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

## Options

- `--mock`: use deterministic local model behavior. No network or provider key required.
- `--cwd PATH`: workspace directory used by project settings discovery and shell commands.
- `--listen HOST:PORT`: bind address for `ndx serve`. The default is `127.0.0.1:0`.
- `--connect ws://HOST:PORT`: send the prompt to an existing session server.
- `--help`: print CLI help.
- `--version`: print package version.

## Session Server API

The session server is a WebSocket JSON-RPC endpoint. It owns live thread state,
event fan-out, and JSONL persistence. Clients send requests and receive
notifications; they are not authoritative session stores.

Requests:

| Method             | Params                  | Result                         |
| ------------------ | ----------------------- | ------------------------------ |
| `initialize`       | none                    | server name, protocol, methods |
| `thread/start`     | `{ cwd? }`              | `{ thread }`                   |
| `thread/subscribe` | `{ threadId }`          | `{ thread, events }`           |
| `thread/read`      | `{ threadId }`          | `{ thread, events }`           |
| `turn/start`       | `{ threadId, prompt }`  | `{ turn }`                     |
| `turn/interrupt`   | `{ threadId, reason? }` | `{ thread }`                   |

Notifications:

- `thread/started`
- `thread/sessionConfigured`
- `turn/started`
- `item/toolCall`
- `item/toolResult`
- `item/agentMessage`
- `thread/tokenUsage/updated`
- `turn/completed`
- `turn/aborted`
- `warning`
- `error`

Server JSONL records are written to
`<globalDir>/sessions/ts-server/<threadId>.jsonl`.

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

`keys` are merged into the shell tool environment. `env` is accepted as a compatibility alias but `keys` is the canonical settings field.

## Search Rules

`/home/.ndx/search.json` stores provider-specific request, response parsing, ranking, and interpretation rules. The file is loaded separately from credentials so rules can evolve without changing model/provider settings.

## Model API

The OpenAI-compatible adapter sends `POST {provider.url}/chat/completions` with:

- `model`
- `messages`
- `tools` containing the TypeScript tool registry function schemas
- `tool_choice = "auto"`

If `provider.key` is an empty string, no `Authorization` header is sent. The adapter keeps chat history in memory for the current CLI run and converts tool results into `role = "tool"` messages.

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
