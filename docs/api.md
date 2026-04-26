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
- `tools` containing the local `shell` function schema
- `tool_choice = "auto"`

If `provider.key` is an empty string, no `Authorization` header is sent. The adapter keeps chat history in memory for the current CLI run and converts shell results into `role = "tool"` messages.
