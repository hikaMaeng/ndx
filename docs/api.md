# API

## CLI

```bash
ndx [SERVER_ADDRESS]
ndx serve [--mock] [--cwd PATH] [--listen HOST:PORT] [--dashboard-listen HOST:PORT]
ndxserver [--mock] [--cwd PATH] [--listen HOST:PORT] [--dashboard-listen HOST:PORT]
ndxserver serve [--mock] [--cwd PATH] [--listen HOST:PORT] [--dashboard-listen HOST:PORT]
ndxserver stop [--dashboard-listen HOST:PORT]
ndx --connect ws://HOST:PORT [--cwd PATH] [prompt]
ndx --mock [--cwd PATH] [prompt]
```

- `SERVER_ADDRESS` defaults to `127.0.0.1:45123`.
- Plain `ndx` starts a detached `ndxserver` process when `SERVER_ADDRESS` is
  unreachable, then connects to it.
- On Windows, plain `ndxserver` starts or verifies a background managed server;
  `ndxserver serve` runs the foreground server body.
- `ndxserver stop` calls the dashboard exit endpoint and waits for the socket
  endpoint to become unreachable. It defaults to `127.0.0.1:45124` unless
  `--dashboard-listen` is supplied.
- `--mock` uses the deterministic mock model and does not require provider
  credentials.
- `--cwd` sets the server/session working directory.
- `--listen` binds the WebSocket listener in server mode.
- `--dashboard-listen` binds the dashboard HTTP listener in server mode.
- `--connect` sends a prompt to an existing WebSocket server.
- `--version` prints the package version.

## Slash Commands

Slash commands are parsed by the CLI and sent as `command/execute`; they are not
added to model context.

| Command           | Behavior                                          |
| ----------------- | ------------------------------------------------- |
| `/help`           | Print session-server commands.                    |
| `/status`         | Print server and current session status.          |
| `/init`           | Print latest initialization detail.               |
| `/events`         | Print recent runtime event types.                 |
| `/login`          | Create or switch local user identity.             |
| `/blockuser`      | Block a local user id.                            |
| `/unblockuser`    | Unblock a local user id.                          |
| `/session`        | List saved and live sessions for the current cwd. |
| `/restoreSession` | Switch to a saved session by UUID or list number. |
| `/deleteSession`  | Delete another session for the current cwd.       |
| `/interrupt`      | Interrupt the current turn.                       |
| `/compact`        | Summarize saved context and restart from it.      |
| `/context`        | Print current context usage by item kind.         |
| `/lite`           | Toggle lite context mode with `on` or `off`.      |
| `/exit`           | Close the CLI client.                             |

`/exit` does not stop a managed detached server. Use a process signal or the
dashboard exit endpoint for server shutdown.

`/context` includes conversation history plus startup instruction estimates.
AGENTS.md and skill catalog entries are grouped as project or user sources,
separate from message and tool rows.

## WebSocket JSON-RPC

The session server is a WebSocket JSON-RPC endpoint. `server/info`,
`account/previous`, `account/create`, and `account/login` are public. Other
methods require login on that socket.

Requests:

| Method                     | Params                                                    | Result                                                    |
| -------------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| `server/info`              | none                                                      | server, version, runtime, sandbox, protocol               |
| `initialize`               | none                                                      | server, methods, bootstrap, dashboard URL, loaded sources |
| `command/list`             | none                                                      | command definitions                                       |
| `command/execute`          | `{ name, args?, sessionId?, user?, clientId? }`           | command result                                            |
| `account/previous`         | none                                                      | last non-blocked account                                  |
| `account/create`           | `{ username }`                                            | created account                                           |
| `account/login`            | `{ username?, clientId? }`                                | socket identity                                           |
| `session/start`            | `{ cwd?, user?, clientId? }`                              | live session                                              |
| `session/list`             | `{ cwd?, user?, clientId? }`                              | workspace sessions                                        |
| `session/restore`          | `{ cwd?, selector, user?, clientId? }`                    | session plus events                                       |
| `session/deleteCandidates` | `{ cwd?, currentSessionId?, user?, clientId? }`           | delete candidates                                         |
| `session/delete`           | `{ cwd?, selector, currentSessionId?, user?, clientId? }` | deleted session                                           |
| `session/subscribe`        | `{ sessionId, user?, clientId? }`                         | session plus events                                       |
| `session/read`             | `{ sessionId }`                                           | session plus events                                       |
| `turn/start`               | `{ sessionId, prompt, user?, clientId? }`                 | turn id                                                   |
| `turn/interrupt`           | `{ sessionId, reason? }`                                  | updated session                                           |

`initialize.sources` lists the server-recognized settings, AGENTS.md, and
`SKILL.md` files. `initialize.contextSources` carries the AGENTS.md and skill
source groups used by `/context`; clients use it for startup visibility and do
not add it to model context. Notifications include `session/started`,
`session/restored`, `session/deleted`, and runtime event notifications.

## Dashboard HTTP

`GET /` and `GET /dashboard` render the dashboard. `POST /api/reload` reloads
settings, AGENTS.md instruction sources, skill sources, and bootstrap state.
`POST /api/exit` requests server shutdown.
`GET /api/dashboard/summary` returns account, project, session, event, live
session, and connected-client counts for the overview view.
`GET /api/dashboard/users` returns local SQLite users with created time,
`lastlogin`, block/protected state, session count, project count, event count,
and latest session activity. Session log APIs remain under
`/api/session-log/*`: facets, filtered sessions, per-session event pages, and
session deletion by id.
