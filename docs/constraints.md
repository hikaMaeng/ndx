# Constraints

## Config

- Global settings path is fixed at `/home/.ndx/settings.json`.
- Project settings path is `.ndx/settings.json` under the nearest ancestor project directory.
- No runtime environment variable is used to select model, provider URL, provider key, or ndx home.
- Settings are JSON only; `config.toml`, `.codex`, `NDX_HOME`, `NDX_MODEL`, `OPENAI_BASE_URL`, and `OPENAI_API_KEY` are not part of the ndx TypeScript loader contract.
- `keys` values must be strings because they are injected into shell tool environment variables.
- Provider `key` may be an empty string.
- Unknown JSON object fields are preserved only where the runtime type allows extension, such as `websearch`, `mcp`, and `search`.

## Search

- Web-search credentials live in `settings.json` under `websearch`.
- Web-search parsing and interpretation rules live in global `/home/.ndx/search.json`.
- The current runtime loads search settings and rules but does not yet expose a web-search tool to the model loop.

## Shell Tool

- Shell commands run through `/bin/bash -lc` on Unix and `cmd.exe` on Windows.
- Shell environment is `process.env` overlaid with `settings.json` `keys` and compatibility `env` values.
- The default shell timeout is `120000` ms.

## OpenAI

- Real model execution uses the active model's provider from `settings.json`.
- The current implementation supports OpenAI-compatible chat completions function tool calls, not MCP, image, patch, browser, or web-search tools.

## Browser Markup

No frontend view is rendered by this package. Browser locator contracts are not applicable.
