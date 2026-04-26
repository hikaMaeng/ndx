# Internals

## Config Loader

`configFiles(cwd)` returns `/home/.ndx/settings.json` followed by the nearest ancestor `.ndx/settings.json` when present. `loadConfig(cwd)` reads those JSON files in order, merges them, then loads `/home/.ndx/search.json` as search rules.

## Settings Merge

Scalar fields such as `model`, `instructions`, `maxTurns`, and `shellTimeoutMs` use last writer wins. `providers`, `permissions`, `websearch`, `mcp`, `keys`, and compatibility `env` are merged by key. `models` are merged by model name.

## Active Provider

`finalizeConfig` resolves `model` to one `models[]` entry, then resolves that entry's `provider` against `providers`. OpenAI-compatible execution reads URL and key from that resolved provider only.

## Tool Loop

`runAgent` keeps `previous_response_id` when the provider returns one. Tool outputs use Responses-style `function_call_output` items internally and are converted to chat completions `role = "tool"` messages by the OpenAI-compatible adapter.

## Mock Client

`MockModelClient` emits one `shell` call on the first turn and final text on the second turn. It is intentionally deterministic so Docker verification does not depend on external APIs.

## Docker Context

Docker build does not copy source folders from the local build context. The Dockerfile installs Git, clones `NDX_GIT_REPO` at `NDX_GIT_REF`, uses `NDX_GIT_CACHE_BUST` to avoid stale branch-cache builds, then installs dependencies and builds inside the cloned checkout.
