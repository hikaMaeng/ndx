# Internals

## Config Cascade

`configFiles(cwd)` returns the global config followed by ancestor project configs. `loadConfig(cwd)` reads existing files in that order and merges them into `NdxConfig`.

## Tool Loop

`runAgent` keeps `previous_response_id` when the provider returns one. Tool outputs use Responses API `function_call_output` items with the original `call_id`.

## Mock Client

`MockModelClient` emits one `shell` call on the first turn and final text on the second turn. It is intentionally deterministic so Docker verification does not depend on external APIs.

## Docker Context

`.dockerignore` excludes Rust, SDK, and vendored upstream directories. The Docker image contains only the TypeScript runtime, tests, and docs needed for verification.
