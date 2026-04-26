# API

## CLI

```bash
ndx [--mock] [--cwd PATH] <prompt>
```

## Options

- `--mock`: use deterministic local model behavior. No network or API key required.
- `--cwd PATH`: workspace directory used by config discovery and shell commands.
- `--help`: print CLI help.
- `--version`: print package version.

## Config

Config files are TOML files named `config.toml`.

Load order:

1. `${NDX_HOME:-/home/ndx/.ndx}/config.toml`
2. Every `.ndx/config.toml` from root to `cwd`

Supported fields:

```toml
model = "gpt-5"
instructions = "Agent instructions"
max_turns = 8
shell_timeout_ms = 120000

[env]
NAME = "value"
```

Project config overrides global config. `[env]` tables are merged by key.

## Model API

The OpenAI adapter sends `POST /v1/responses` with:

- `model`
- `instructions`
- `input`
- `tools` containing the local `shell` function schema
- `parallel_tool_calls = false`
- `previous_response_id` after the first turn
