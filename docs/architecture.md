# Architecture

## Modules

- `src/cli.ts`: argument parsing, config load, model client selection, event output.
- `src/config.ts`: `.ndx/config.toml` cascade and minimal TOML parsing.
- `src/agent.ts`: Responses-style model/tool loop.
- `src/openai.ts`: OpenAI Responses API adapter and response normalization.
- `src/mock-client.ts`: deterministic model client for Docker and unit tests.
- `src/tools/shell.ts`: shell tool schema and process execution.
- `src/types.ts`: shared runtime contracts.

## Runtime Flow

1. CLI resolves `cwd` and reads config layers.
2. CLI chooses `MockModelClient` for `--mock`, otherwise `OpenAiResponsesClient`.
3. `runAgent` sends the prompt to the model client.
4. Function calls named `shell` are executed locally.
5. Tool outputs are sent back as `function_call_output` items until the model returns text without tool calls.

## Docker Flow

`npm run deploy` builds locally, removes previous compose containers, builds `ndx-agent`, runs tests in the image, runs a mock agent command in the image, then tears compose down.
