# Test Plan: client-context-model-routing
## Created
2026-04-30

## Goal
Verify that ndx does not depend on inference-server session state, sends local
client-side context on every provider request, supports per-request model
round-robin, and routes prompts with `@custom` keywords to custom model pools.

## Environment
- Workspace: `/mnt/f/dev/ndx`
- Runtime: Node.js from local shell
- Container verification: `npm run deploy`
- Browser verification: not applicable; this package has no frontend view.

## Preconditions
- Dependencies installed.
- For deploy verification, the current branch is pushed because the Dockerfile
  clones `NDX_GIT_REF` from GitHub.
- `/home/.ndx/settings.json` or project settings exist for non-mock startup.

## Steps
1. Run `npm test`.
2. Confirm config tests parse string and object model settings, including
   `model.custom`.
3. Confirm model adapter tests prove OpenAI Responses requests omit
   `previous_response_id`.
4. Confirm router tests prove session round-robin and `@deep` custom routing.
5. Confirm agent tests prove tool follow-up requests include user message,
   assistant tool call, and function output in one local stack.
6. Confirm session-server tests prove sessions keep the base config and no
   longer bind one concrete model per session.
7. After pushing the branch, run `npm run deploy` for the branch image.
8. After merge to `main`, run the same deploy flow on `main`.

## Expected Results
- `npm test` passes.
- Docker branch deploy passes local build, compose cleanup, no-cache image build,
  in-container tests, mock agent verification, and compose cleanup.
- Docker main deploy passes the same checks after merge.
- No provider request requires `previous_response_id`.
- Session restore source remains JSONL-backed runtime events, not provider
  server-side context.

## Logs To Capture
- `npm test` TAP summary.
- `npm run deploy` summary for branch.
- `npm run deploy` summary for `main`.
- Any Docker compose cleanup, build, or mock-agent failure.

## Locator Contract
Not applicable. No browser UI exists in this package.
