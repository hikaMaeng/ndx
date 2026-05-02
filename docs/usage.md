# Usage

## Install

```bash
yarn install --immutable
```

Yarn runs in Plug'n'Play mode with the global cache enabled, so installs do not
create a workspace `node_modules` tree.

## Build And Test

```bash
npm test
```

## Settings

Global settings live at `/home/.ndx/settings.json`. Project settings may still live at `.ndx/settings.json` in the project directory as an override, but first-run setup writes the global file. The repository includes a non-secret project settings file for the local LM Studio-compatible endpoint.

Do not put real provider, Tavily, GitHub, Docker Hub, npm, or GitLab tokens in repository files. Put secrets in `/home/.ndx/settings.json` on the local machine.

MCP servers may be declared in settings. Project MCP has priority over global MCP:

```json
{
  "mcp": {
    "memory": {
      "command": "node",
      "args": ["./mcp-memory.js"],
      "tools": [
        {
          "name": "create_entities",
          "description": "Create memory graph entities.",
          "inputSchema": { "type": "object", "properties": {} }
        }
      ]
    }
  }
}
```

Plugin and capability tools are filesystem packages, not settings entries. Put each tool in a folder named after the tool and include `tool.json`; for example `/home/.ndx/tools/shell/tool.json` or `<project>/.ndx/plugins/calendar/tools/create_event/tool.json`.

## Host CLI

```bash
npm install -g @neurondev/ndx --registry https://verdaccio.neurondev.net/
cd /path/to/project
ndx [SERVER_ADDRESS]
```

`SERVER_ADDRESS` is optional and defaults to `127.0.0.1:45123`. The host CLI
connects to that ndx server first. If the socket is not reachable, it reports
the miss, starts a local default server at the default address, and then
connects over WebSocket.

The current folder is the project folder. Docker is used only after the server
is running, as a per-folder sandbox for shell-like tools with the project
mounted at `/workspace`.

Use `NDX_SANDBOX_IMAGE` to override the sandbox image for explicit verification.
Use `NDX_CLI_STATE_DIR` to move host CLI app state. Host CLI login state is not
stored in `/home/.ndx` or project `.ndx`.

## Mock Agent

```bash
NDX_EMBEDDED_SERVER=1 node dist/src/cli/main.js --mock "create a file named tmp/verify.txt with text verified"
```

`--mock` starts an embedded loopback session server for source-tree development,
connects over WebSocket, sends `initialize`, logs in from CLI app state or
`defaultUser`, starts a session, and sends the prompt as a user turn. The server
owns the live session and writes accounts plus sessions to
`/home/.ndx/system/ndx.sqlite` once the first prompt is submitted. Set optional
`dataPath` in settings to move the SQLite data directory; legacy `sessionPath`
is treated as the same data-directory override.

On startup, config loading and the session server both enforce required global
`.ndx` elements. Missing `system/tools/`, built-in core tool
package files, and `system/skills/` are installed before session work begins. If
neither global nor project settings exist and the CLI is attached to a TTY, ndx
asks for permission mode, provider type, provider key, provider URL, model name,
and max context, then writes `/home/.ndx/settings.json`. Non-TTY startup still
requires an existing settings file. The socket initialization output includes a
bootstrap report showing what was installed and what already existed. The
loader also appends discovered `AGENTS.md` files from the current directory
ancestry to the runtime instructions and lists them in initialization sources.

## Session Server

Run a long-lived server:

```bash
node dist/src/cli/main.js serve --mock --listen 127.0.0.1:45123
```

Direct server command:

```bash
node dist/src/cli/main.js --help
ndxserver --mock --listen 127.0.0.1:45123 --dashboard-listen 127.0.0.1:45124
```

Attach a client to that server:

```bash
node dist/src/cli/main.js --connect ws://127.0.0.1:45123 "list files"
```

Attached clients use the same session-client controller as embedded mode. They
display socket initialization and session status, but the remote server remains
the authority for live state, initialization detail, event broadcast, and
persistence. Each CLI controller instance sends a fresh `clientId` and logs in
before using session, command, or turn methods. The server tracks distinct
connections even when user, workspace, and session are the same.

Open the printed dashboard URL when the server is running. CLI initialization
also prints the dashboard URL returned by the connected server. The dashboard
listener has no authentication or authorization. Agent interaction remains on
authenticated WebSocket JSON-RPC.

Dashboard actions:

```text
Reload  Re-run global .ndx bootstrap and re-read settings plus AGENTS.md sources.
Exit    Request the local server process to stop.
```

Dashboard UI copy is English-only.

## Interactive Commands

```text
/help       Show session-server commands.
/status     Show socket, server, and current session status.
/init       Show the latest session initialization detail received from server events.
/events     Show recent runtime event types recorded on the current session.
/login      Choose Google login, GitHub login, current account, or defaultUser.
/session    List live and saved sessions for the current workspace.
/restoreSession N  Switch to a session by UUID or by the number shown in /session.
/deleteSession  List other sessions for this workspace and delete the selected number.
/interrupt  Ask the session server to interrupt the active turn.
/exit       Leave ndx.
```

Slash commands are sent to the session server with `command/execute`.
Initialization detail is for operator visibility only. The CLI does not append
slash command text or initialization detail to the model prompt.

`/session` is scoped to the `cwd` passed when `ndx` started or connected. The
number column is the session creation sequence for that workspace. Empty
sessions are not listed until the first prompt assigns a number and title.
`/deleteSession` uses the same scope, excludes the current session, and cancels
when Enter is submitted without a number.

`/login` options:

```text
1. Google login
2. GitHub login
3. Keep current account
4. Switch to default user
```

Google and GitHub use device login. Set `NDX_GOOGLE_CLIENT_ID` or
`NDX_GITHUB_CLIENT_ID` in the host CLI environment. Successful login updates the
single shared CLI `auth.json` last-login value; the next CLI instance reuses
that account. Option 4 stores `defaultUser` as the last-login value.

## Real Agent

```bash
node dist/src/cli/main.js "inspect this repository and summarize the test command"
```

The active provider comes from settings. Empty provider keys are allowed for local OpenAI-compatible servers such as LM Studio.

`model` may be a string or a pool object. String form keeps the legacy single
model behavior. Object form requires `session` and may declare `worker`,
`reviewer`, and `custom` pools:

```json
{
  "model": {
    "session": ["local-main-a", "local-main-b"],
    "worker": ["local-worker-a", "local-worker-b"],
    "reviewer": ["local-review-a"],
    "custom": {
      "deep": ["local-review-a", "local-review-b"],
      "fast": "local-main-a"
    }
  }
}
```

The first request for a selected pool uses a load-spreading pick, then the
session stays sticky to that model while the model, effort, thinking mode, and
pool remain unchanged. Normal prompts use `model.session`. A prompt containing
`@deep` uses `model.custom.deep` for that turn, and tool follow-up requests keep
the same custom pool. `worker` and `reviewer` are validated but are not
connected to runtime dispatch yet.

`models` may be the legacy array or an object keyed by local model ID. Object
form lets local aliases point to the same provider model with different runtime
parameters:

```json
{
  "models": {
    "local-high": {
      "name": "local-model-high",
      "provider": "local-openai",
      "maxContext": 262000,
      "effort": ["low", "medium", "high"],
      "think": true,
      "limitResponseLength": 4096,
      "topK": 40,
      "repeatPenalty": 1.05,
      "presencePenalty": 0.1,
      "topP": 0.9,
      "MinP": 0.05
    }
  }
}
```

Use `/model`, `/effort`, and `/think` to inspect or change the live session
state. `/model` lists session models with numbers and accepts either a number
or model ID. `/effort` lists the active model effort choices when the model
declares an `effort` array, and `/think` lists on/off choices when the model
declares `think`. Changing model, effort, or thinking mode starts a new provider
client binding for the next request, so the prefix cache is expected to restart
at that explicit boundary. Model changes reset effort to the middle configured
choice and thinking mode to on when those controls are supported.

OpenAI-compatible Responses requests do not use `previous_response_id`. ndx
resends the local client-side conversation stack on every model request so
sessions can survive provider restarts, explicit model switching, and local or
remote inference server restarts.

## Docker

`npm run deploy` builds and tests the TypeScript server locally, removes prior
compose containers, rebuilds the `ndx-sandbox` Docker image, starts the sandbox
with `./docker/volume/workspace` mounted at `/workspace`, writes
`/workspace/tmp/ndx-docker-verify.txt`, and tears compose down.

```bash
npm run deploy
```

Build the sandbox image explicitly with:

```bash
docker compose build --no-cache ndx-sandbox
```

## Local OpenAI-Compatible Model

This repository does not ship a project `.ndx/settings.json` with a default
real model. If neither `/home/.ndx/settings.json` nor a project settings file is
found, interactive CLI startup uses the settings wizard to create one.

Start the local server with `ndx` or `ndx serve`. The default compose service
starts only the tool sandbox; it does not publish ndx service ports:

- WebSocket JSON-RPC: `ws://127.0.0.1:45123`
- Dashboard HTTP: `http://127.0.0.1:45124`

```bash
docker compose up -d --build ndx-sandbox
docker compose exec -T ndx-sandbox bash -lc "pwd"
ndx
```

Override the sandbox image for verification with:

```bash
NDX_SANDBOX_IMAGE=hika00/ndx-sandbox:0.1.0 ndx
```

Docker Desktop Exec tab also works after the container is running. Open the
`ndx-sandbox` container and run:

```bash
bash
```

That opens the ndx prompt. Submit tasks at `ndx>`, use `/help` for local commands, and `/exit` to leave. You can still run one-shot prompts with:

```bash
ndx "원하는 작업"
```

The default compose service stays alive with `sleep infinity`. It does not copy
repository settings into `/home/.ndx`; real model settings remain owned by the
normal global/current-project settings cascade and the interactive wizard. Files created
by sandbox commands persist in `./docker/volume/workspace`.
