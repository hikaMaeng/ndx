# Configuration

ndx loads JSON settings, not upstream Codex `config.toml`.

## Files

- Global settings: `/home/.ndx/settings.json`.
- Project override: `<project>/.ndx/settings.json`.
- Web-search rules: `/home/.ndx/search.json`.
- Default SQLite data directory: `/home/.ndx/system`.

The loader reads global settings first, then project settings. Project values
override global values. `dataPath` overrides the SQLite data directory;
`sessionPath` is accepted as a legacy alias for the same value.

## Required Shape

```json
{
  "version": "0.1.14",
  "model": "local-model",
  "providers": {
    "local": {
      "type": "openai",
      "key": "env-or-local-secret",
      "url": "http://localhost:1234/v1"
    }
  },
  "models": [
    {
      "name": "local-model",
      "provider": "local",
      "maxContext": 128000
    }
  ],
  "keys": {}
}
```

Every settings file must declare the installed ndx package version. Valid stale
files are version-bumped in place. Incomplete files are repaired by the TTY
settings wizard when a TTY is available.

## Model Controls

Models may declare:

- `id`: local selection alias.
- `name`: provider-facing model name.
- `provider`: provider key.
- `maxContext`: model context limit for `/context` reporting.
- `effort`: accepted reasoning effort values.
- `think`: whether thinking mode can be toggled.
- `limitResponseLength`, `temperature`, `topK`, `repeatPenalty`,
  `presencePenalty`, `topP`, and `MinP`: provider request options.

`modelPools.session`, `modelPools.worker`, `modelPools.reviewer`, and
`modelPools.custom` define routing pools. Live sessions keep sticky selected
models until `/model`, `/effort`, or `/think` changes the binding.

## Tools And MCP

`tools.dockerSandboxImage` may override the pinned sandbox image only for
explicit verification. Normal runtime defaults to `hika00/ndx-sandbox:0.1.0`.

`mcp`, `globalMcp`, and `projectMcp` entries use command-backed stdio servers.
MCP commands execute through the server-managed Docker tool sandbox when the
sandbox is active.

## Secrets

Do not commit real provider, GitHub, Docker Hub, npm, GitLab, or web-search
tokens. Store local secrets in `/home/.ndx/settings.json` or the host credential
store.
