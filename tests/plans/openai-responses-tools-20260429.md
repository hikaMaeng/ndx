# Test Plan: openai-responses-tools

## Created

2026-04-29

## Goal

Verify OpenAI Responses requests receive provider-compatible function tool
schemas instead of Chat Completions nested function schemas.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Branch: `codex/sessionlistrestore`
- Shell: bash
- Runtime: Node.js tests and Docker Compose `ndx-agent`

## Preconditions

- Core `tool.json` manifests remain Chat Completions-compatible registry
  schemas.
- OpenAI-compatible providers use the Responses endpoint before fallback.

## Steps

1. Convert a registry-style `{ type: "function", function: ... }` tool through
   the Responses adapter helper.
2. Verify the converted tool is `{ type: "function", name, description,
   parameters }`.
3. Run `npm test`.
4. Rebuild and restart the compose service from the current branch.
5. Verify a container prompt can start without `tools.0.type` validation
   failure.

## Expected Results

- Chat Completions tool schemas are unchanged for chat fallback.
- Responses requests use the flat function tool shape.
- Docker Compose service runs the updated image.

## Logs To Capture

- `npm test`
- `docker compose up -d --build ndx-agent`
- Container prompt output
