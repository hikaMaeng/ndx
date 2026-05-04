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
- `ndxserver stop` calls the dashboard exit endpoint. It defaults to
  `127.0.0.1:45124` unless `--dashboard-listen` is supplied.
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
| `/login`          | Switch login identity.                            |
| `/session`        | List saved and live sessions for the current cwd. |
| `/restoreSession` | Switch to a saved session by UUID or list number. |
| `/deleteSession`  | Delete another session for the current cwd.       |
| `/interrupt`      | Interrupt the current turn.                       |
| `/exit`           | Close the CLI client.                             |

`/exit` does not stop a managed detached server. Use a process signal or the
dashboard exit endpoint for server shutdown.

## WebSocket JSON-RPC

The session server is a WebSocket JSON-RPC endpoint. `server/info`,
`account/create`, `account/login`, and `account/socialLogin` are public.
Other methods require login on that socket.

Requests:

| Method                     | Params                                                          | Result                                      |
| -------------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| `server/info`              | none                                                            | server, version, runtime, sandbox, protocol |
| `initialize`               | none                                                            | server, methods, bootstrap, dashboard URL   |
| `command/list`             | none                                                            | command definitions                         |
| `command/execute`          | `{ name, args?, sessionId?, user?, clientId? }`                 | command result                              |
| `account/create`           | `{ username, password? }`                                       | created account                             |
| `account/login`            | `{ username?, password?, clientId? }`                           | socket identity                             |
| `account/socialLogin`      | `{ provider, subject?, accessToken, refreshToken?, clientId? }` | social account identity                     |
| `account/delete`           | `{ username }`                                                  | deletion result                             |
| `account/changePassword`   | `{ username, oldPassword?, newPassword }`                       | update timestamp                            |
| `session/start`            | `{ cwd?, user?, clientId? }`                                    | live session                                |
| `session/list`             | `{ cwd?, user?, clientId? }`                                    | workspace sessions                          |
| `session/restore`          | `{ cwd?, selector, user?, clientId? }`                          | session plus events                         |
| `session/deleteCandidates` | `{ cwd?, currentSessionId?, user?, clientId? }`                 | delete candidates                           |
| `session/delete`           | `{ cwd?, selector, currentSessionId?, user?, clientId? }`       | deleted session                             |
| `session/subscribe`        | `{ sessionId, user?, clientId? }`                               | session plus events                         |
| `session/read`             | `{ sessionId }`                                                 | session plus events                         |
| `turn/start`               | `{ sessionId, prompt, user?, clientId? }`                       | turn id                                     |
| `turn/interrupt`           | `{ sessionId, reason? }`                                        | updated session                             |

Notifications include `session/started`, `session/restored`,
`session/deleted`, and runtime event notifications.

## Dashboard HTTP

`GET /` and `GET /dashboard` render the dashboard. `POST /api/reload` reloads
settings and bootstrap state. `POST /api/exit` requests server shutdown.
