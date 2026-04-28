# API

## CLI

```bash
ndx [--mock] [--cwd PATH] [prompt]
```

`ndx` without a prompt on a TTY opens the interactive `ndx>` prompt.

## Options

- `--mock`: use deterministic local model behavior. No network or provider key required.
- `--cwd PATH`: workspace directory used by project settings discovery and shell commands.
- `--help`: print CLI help.
- `--version`: print package version.

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

## Built-In Tools

The TypeScript registry ports the Rust Codex default local tool surface as function tools:

| Tool                                                                                                                     | Contract                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `shell`                                                                                                                  | Run a local shell command with `command`, optional `cwd`, and optional `timeoutMs`.                       |
| `shell_command`                                                                                                          | Run a shell script with Rust-compatible `command`, `workdir`, `timeout_ms`, and `login` fields.           |
| `exec_command`                                                                                                           | Run a command and return output or a `session_id` for ongoing interaction.                                |
| `write_stdin`                                                                                                            | Write to or poll an `exec_command` session.                                                               |
| `update_plan`                                                                                                            | Record a structured task plan.                                                                            |
| `request_user_input`                                                                                                     | Exposed for parity; returns unavailable in the non-interactive CLI.                                       |
| `request_permissions`                                                                                                    | Exposed for parity; returns denied because no approval client exists.                                     |
| `apply_patch`                                                                                                            | Invokes the local `apply_patch` command with an `input` patch string.                                     |
| `list_dir`                                                                                                               | List local directory entries with offset, limit, and depth controls.                                      |
| `view_image`                                                                                                             | Return a data URL for a local image path.                                                                 |
| `list_mcp_resources`                                                                                                     | List configured static MCP resources.                                                                     |
| `list_mcp_resource_templates`                                                                                            | List configured static MCP resource templates.                                                            |
| `read_mcp_resource`                                                                                                      | Read a configured static MCP resource.                                                                    |
| `spawn_agent`, `send_input`, `send_message`, `followup_task`, `resume_agent`, `wait_agent`, `close_agent`, `list_agents` | Exposed for Rust Codex parity; return unavailable until a TypeScript multi-agent backend exists.          |
| `spawn_agents_on_csv`, `report_agent_job_result`                                                                         | Exposed for Rust Codex agent-job task parity; return unavailable until a TypeScript batch backend exists. |
| `tool_search`                                                                                                            | Search currently registered tool metadata.                                                                |
| `tool_suggest`                                                                                                           | Exposed for plugin suggestion parity; returns a non-interactive suggestion result.                        |

`web_search` is added when `websearch.provider` is set. It uses Tavily-compatible API settings. `image_generation` is added only when `tools.imageGeneration` is true and currently returns a backend-required error.

## MCP And Plugin Tools

Configured MCP server tools are exposed as `mcp__<server>__<tool>` unless the server entry defines `namespace`. Static schemas come from `mcp.<server>.tools[]`; command-backed stdio calls use the same server entry's `command`, `args`, `cwd`, and `env`.

Configured plugin tools are exposed as `plugin__<id>__<tool>` unless the plugin entry defines `namespace`. Plugin tool commands receive serialized arguments through `NDX_TOOL_ARGS`.

## Parallel Tool Execution

When every tool call in a model response is marked `supportsParallelToolCalls`, the agent starts one isolated Node worker process per call. Each worker builds its own registry instance, executes the requested tool, writes a JSON result to stdout, and exits. Mixed batches or sessionful tools such as `exec_command` and `write_stdin` run through the parent process sequentially.
