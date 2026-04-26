# Constraints

## Config

- Default global config path is `/home/ndx/.ndx/config.toml` unless `NDX_HOME` is set.
- Project config directory is `.ndx` only.
- The TOML parser intentionally supports only the active contract: strings, integers, booleans, root scalar keys, and `[env]` string values.
- Unknown tables and keys are ignored for forward compatibility during the TypeScript migration.

## Shell Tool

- Shell commands run through `/bin/bash -lc` on Unix and `cmd.exe` on Windows.
- Shell environment is `process.env` overlaid with merged config `[env]` values.
- The default shell timeout is `120000` ms.

## OpenAI

- Real model execution requires `OPENAI_API_KEY`.
- `OPENAI_BASE_URL` may override the default `https://api.openai.com/v1`.
- The current implementation supports function tool calls, not MCP, image, patch, or browser tools.

## Browser Markup

No frontend view is rendered by this package. Browser locator contracts are not applicable.
