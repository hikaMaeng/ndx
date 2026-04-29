# Test Plan: session-context-restore

## Created

2026-04-30

## Goal

Verify restored sessions rebuild model-facing conversation context from saved
runtime events before processing the next prompt.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Branch: `main` or feature branch before merge
- Shell: bash
- Runtime: Node.js tests and Docker Compose `ndx-agent`

## Preconditions

- A persisted session JSONL contains prior `turn_started`, `tool_call`,
  `tool_result`, `agent_message`, and `turn_complete` runtime events.
- Restore is performed from a fresh `SessionServer` or after ownership reload.

## Steps

1. Rebuild model conversation history from persisted runtime events.
2. Verify user prompts, assistant messages, and tool call/result pairs are
   represented as provider-facing conversation items with stable restored call
   ids.
3. Restore a saved session from a new server.
4. Send a second prompt and verify the model client receives the previous user
   and assistant messages before the new user prompt.
5. Verify OpenAI Responses conversion turns restored conversation items into
   Responses-compatible input items.
6. Run `npm test`.
7. Run `npm run deploy` or rebuild Docker Compose from the merged branch.

## Expected Results

- Restore means session identity, durable events, ownership, and model
  conversation context are all resumed.
- Chat and Anthropic adapters reset their internal messages when a full restored
  conversation input is supplied, avoiding duplicate history.
- OpenAI Responses receives full conversation input because no durable
  `previous_response_id` can be assumed after process restart.

## Logs To Capture

- `npm test`
- Docker build or compose refresh output
