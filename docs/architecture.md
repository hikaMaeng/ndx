# Architecture

## Modules

- `src/cli.ts`: argument parsing, config load, model client selection, event output.
- `src/config.ts`: JSON settings loader for fixed global settings, nearest project settings, and global search rules.
- `src/agent.ts`: Responses-style model/tool loop.
- `src/openai.ts`: OpenAI-compatible chat completions adapter and response normalization.
- `src/mock-client.ts`: deterministic model client for Docker and unit tests.
- `src/tools/shell.ts`: shell tool schema and process execution.
- `src/types.ts`: shared runtime contracts.

## Runtime Flow

1. CLI resolves `cwd` and reads `/home/.ndx/settings.json`, nearest project `.ndx/settings.json`, and `/home/.ndx/search.json`.
2. CLI chooses `MockModelClient` for `--mock`, otherwise `OpenAiResponsesClient`.
3. `runAgent` sends the prompt to the model client.
4. Function calls named `shell` are executed locally.
5. Tool outputs are sent back as `function_call_output` items until the model returns text without tool calls.

## Docker Flow

`npm run deploy` builds locally, removes previous compose containers, passes the current Git branch as `NDX_GIT_REF`, builds `ndx-agent` with `--no-cache` by cloning that remote branch into `/opt/ndx`, runs tests in the image from `/opt/ndx`, runs a mock agent command against the `/workspace` volume, then tears compose down.
