# Usage

## Install

```bash
pnpm install --registry=https://registry.npmjs.org
```

The explicit registry is useful when local Verdaccio is unavailable.

## Build And Test

```bash
npm test
```

## Settings

Global settings live at `/home/.ndx/settings.json`. Project settings live at `.ndx/settings.json` in the project directory. The repository includes a non-secret project settings file for the local LM Studio-compatible endpoint.

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

## Mock Agent

```bash
node dist/src/cli/main.js --mock "create a file named tmp/verify.txt with text verified"
```

The CLI prints the robot plus uppercase `NDX` startup logo to stderr, starts an
embedded loopback session server, connects over WebSocket, sends `initialize`,
starts a session, and sends the prompt as a user turn. The server owns the live
session and writes session JSONL under `/home/.ndx/sessions/ts-server` once the
first prompt is submitted.

On startup, config loading and the session server both enforce required global
`.ndx` elements. Missing `core/`, `core/tools/`, built-in core tool package
files, and `skills/` are installed before session work begins. `settings.json`
is not generated; create `/home/.ndx/settings.json` or a project
`.ndx/settings.json` before running against a real provider. The socket
initialization output includes a bootstrap report showing what was installed and
what already existed.

## Session Server

Run a long-lived server:

```bash
node dist/src/cli/main.js serve --mock --listen 127.0.0.1:45123
```

Attach a client to that server:

```bash
node dist/src/cli/main.js --connect ws://127.0.0.1:45123 "list files"
```

Attached clients use the same session-client controller as embedded mode. They
display socket initialization and session status, but the remote server remains
the authority for live state, initialization detail, event broadcast, and
persistence.

## Interactive Commands

```text
/help       Show session-server commands.
/status     Show socket, server, and current session status.
/init       Show the latest session initialization detail received from server events.
/events     Show recent runtime event types recorded on the current session.
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

## Real Agent

```bash
node dist/src/cli/main.js "inspect this repository and summarize the test command"
```

The active provider comes from settings. Empty provider keys are allowed for local OpenAI-compatible servers such as LM Studio.

`model` may be a string or a pool object. String form keeps the legacy single
model behavior. Object form requires `session` and may declare `worker` and
`reviewer` placeholders:

```json
{
  "model": {
    "session": ["qwen-main-a", "qwen-main-b"],
    "worker": ["qwen-worker-a", "qwen-worker-b"],
    "reviewer": ["qwen-review-a"]
  }
}
```

New sessions use `model.session` in round-robin order. `worker` and `reviewer`
are validated but are not connected to runtime dispatch yet.

## Docker

`npm run deploy` builds the Docker image from the current pushed Git branch, not from local source folders. Push the feature branch before running deploy. Compose stores runtime workspace and global settings under `./docker/volume`.

```bash
npm run deploy
```

Build another branch explicitly with:

```bash
NDX_GIT_REF=codex/example-feature docker compose build --no-cache ndx-agent
```

## Local OpenAI-Compatible Model

The project `.ndx/settings.json` defaults to:

- `provider`: `lmstudio`
- `url`: `http://192.168.0.6:12345/v1`
- `model`: `qwen3.6-35b-a3b:tr`

Start the container and run a one-shot prompt:

```bash
docker compose up -d --build ndx-agent
docker compose exec ndx-agent ndx "간단히 준비 완료라고 응답해"
```

Docker Desktop Exec tab also works after the container is running. Open the `ndx-agent` container and run:

```bash
ndx
```

That opens the ndx prompt. Submit tasks at `ndx>`, use `/help` for local commands, and `/exit` to leave. You can still run one-shot prompts with:

```bash
ndx "원하는 작업"
```

The default compose service stays alive with `sleep infinity` so interactive exec sessions can start `ndx` on demand. Files created by the agent persist in `./docker/volume/workspace`, and global settings persist in `./docker/volume/home-ndx`.

Compose uses the image default command. Container startup logs include image
provenance lines prefixed with `[ndx-image]`. Those lines record the package
version, GitHub remote, `NDX_GIT_REF`, cloned commit SHA, branch, commit date,
commit subject, Node version, and pnpm version.
