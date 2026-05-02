# Complete System Architecture

This document is the single high-level architecture map for the current ndx
TypeScript runtime. It consolidates the CLI, socket server, auth, project
selection, session runtime, model routing, tool execution, Docker sandbox,
persistence, dashboard, deploy, and package distribution boundaries.

## Architecture Commitments

- `ndx` accepts one normal startup argument: an optional socket server address.
  The default address is `127.0.0.1:45123`.
- The ndx server is a local host process. Docker is not the server body.
- Docker is only a per-workspace sandbox used by shell-like capability tools.
- The server owns live sessions, event fan-out, auth, SQLite persistence,
  project listing, Docker sandbox creation, and tool execution.
- The CLI is a client of the server. It may render status and cache UI state,
  but it is not the authoritative session store.
- Non-login WebSocket JSON-RPC methods require a successful login except public
  `server/info`. The server ignores unauthenticated non-login requests.
- The server depends on a pinned sandbox image. The default image is
  `hika00/ndx-sandbox:0.1.0`.
- Sandbox image changes require a new Docker Hub tag under `hika00`, a pushed
  image, and server verification against that exact tag.
- Package distribution publishes the root package as `@neurondev/ndx`.

## Whole System

```mermaid
flowchart TB
  user["User"]
  cli["Host CLI\nndx"]
  localServer["Local ndx SessionServer\nhost process"]
  remoteServer["Optional existing ndx server\nws://host:port"]
  dashboard["Dashboard HTTP listener\nGET / and /dashboard"]
  sqlite["SQLite store\n<dataDir>/ndx.sqlite"]
  config["Settings and search rules\n/home/.ndx/settings.json\nproject .ndx/settings.json\n/home/.ndx/search.json"]
  runtime["AgentRuntime"]
  loop["runAgent model/tool loop"]
  router["Sticky model router"]
  providers["OpenAI-compatible or Anthropic providers"]
  registry["ToolRegistry"]
  worker["Tool worker Node process"]
  external["External tool.json packages"]
  mcp["MCP stdio servers"]
  sandbox["Docker sandbox container\nper workspace"]
  workspace["Project workspace volume"]

  user --> cli
  cli -->|"probe or connect"| remoteServer
  cli -->|"fallback start"| localServer
  remoteServer --> runtime
  localServer --> runtime
  localServer --> dashboard
  remoteServer --> dashboard
  localServer --> sqlite
  remoteServer --> sqlite
  localServer --> config
  runtime --> loop
  loop --> router
  router --> providers
  loop --> registry
  registry --> worker
  worker --> external
  worker --> mcp
  external -->|"shell-like tools use docker exec"| sandbox
  sandbox --> workspace
```

## Source Ownership

```mermaid
flowchart LR
  src["src/"]
  cli["src/cli\nentrypoint, managed startup,\ninteractive client UI, auth helpers"]
  config["src/config\nsettings discovery,\nmerge, bootstrap core tools"]
  shared["src/shared\nprotocol and runtime data contracts"]
  session["src/session\nWebSocket server/client,\nSQLite, commands, tools,\nDocker sandbox"]
  runtime["src/runtime\nturn coordinator,\nabort, error classification"]
  agent["src/agent\nmodel/tool sampling loop"]
  model["src/model\nprovider adapters and router"]
  process["src/process\nstandalone process runner\nand TaskQueue"]

  src --> cli
  src --> config
  src --> shared
  src --> session
  src --> runtime
  src --> agent
  src --> model
  src --> process

  agent --> model
  agent --> session
  runtime --> agent
  session --> runtime
  session --> process
  config --> shared
  cli --> session
  cli --> config
```

## CLI Startup

Normal `ndx` startup has one optional positional argument. Compatibility and
development paths still exist for `--mock`, `--connect`, `serve`, `ndxserver`,
and `NDX_EMBEDDED_SERVER=1`.

```mermaid
sequenceDiagram
  actor User
  participant CLI as ndx CLI
  participant Socket as Requested socket address
  participant Server as Local SessionServer
  participant Config as Config loader and wizard
  participant Docker as Docker sandbox
  participant DB as SQLite

  User->>CLI: ndx [SERVER_ADDRESS]
  CLI->>Socket: probe WebSocket
  alt socket reachable
    CLI->>Socket: connect
  else socket missing
    CLI-->>User: report failed connection
    CLI->>Config: resolve current-folder settings
    alt no settings and TTY
      Config-->>User: settings wizard
      Config->>Config: write /home/.ndx/settings.json
    else no settings and non-TTY
      Config-->>CLI: fail
    end
    CLI->>Server: start local default server
    Server->>DB: open <dataDir>/ndx.sqlite
    Server->>Docker: ensure current-folder sandbox
    Docker-->>Server: container ready or fatal warning
    CLI->>Server: connect
  end
  CLI->>Server: account/login
  Server-->>CLI: authenticated connection
  CLI->>Server: initialize
  Server-->>CLI: methods and bootstrap report
  CLI-->>User: session selection
```

## First-Run And Session Selection

```mermaid
flowchart TD
  start["CLI needs a session"]
  settings{"settings.json exists?\n/home/.ndx or current project .ndx"}
  tty{"TTY available?"}
  wizard["Run settings wizard\nwrite /home/.ndx/settings.json"]
  fail["Fail config load\nnon-interactive startup cannot invent model settings"]
  cwd["Current folder is session cwd"]
  sessions["Show session choices\nnew, restore, delete candidates"]

  start --> settings
  settings -->|"yes"| cwd
  settings -->|"no"| tty
  tty -->|"yes"| wizard --> cwd
  tty -->|"no"| fail
  cwd --> sessions
```

## Socket Auth Boundary

The authenticated WebSocket connection user is authoritative. User fields in
later request params are accepted for compatibility, but server-side execution
is scoped to the authenticated connection user.

```mermaid
sequenceDiagram
  participant Client
  participant Server
  participant Store as SqliteSessionStore

  Client->>Server: WebSocket open
  Client->>Server: server/info
  Server-->>Client: server version, runtime, sandbox, protocol
  Client->>Server: initialize or session/start without login
  Server-->>Client: ignored if method is not public
  Client->>Server: account/login defaultUser
  Server->>Store: verify or create local default account
  Store-->>Server: user record
  Server-->>Client: username, clientId, sessionRoot
  Client->>Server: initialize
  Server-->>Client: protocol, methods, bootstrap
  Client->>Server: session/start, turn/start, command/execute
  Server->>Server: use authenticated connection user
```

Public socket methods:

| Method                | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `server/info`         | Return server identity for pre-login CLI display.         |
| `account/create`      | Create an account in the local service database.          |
| `account/login`       | Authenticate username and password or local default user. |
| `account/socialLogin` | Validate provider token and map `provider:subject`.       |

All other socket methods require login on that WebSocket connection.

## Server API Shape

```mermaid
flowchart TB
  client["Socket client\nCLI, future TUI, VS Code, app UI"]
  rpc["WebSocket JSON-RPC"]
  public["Public account methods"]
  auth["Authenticated methods"]
  init["initialize"]
  command["command/list\ncommand/execute"]
  session["session/start\nsession/list\nsession/restore\nsession/delete\nsession/subscribe\nsession/read"]
  turn["turn/start\nturn/interrupt"]
  notify["Notifications\nsession, turn, item, warning, error"]

  client <--> rpc
  rpc --> public
  rpc --> auth
  auth --> init
  auth --> command
  auth --> session
  auth --> turn
  session --> notify
  turn --> notify
  notify --> client
```

## Session Lifecycle

```mermaid
stateDiagram-v2
  [*] --> Empty: session/start
  Empty --> Persisted: first turn/start creates durable row
  Persisted --> Running: prompt scheduled
  Running --> Idle: turn completed
  Running --> Aborted: turn/interrupt
  Aborted --> Idle: abort event stored
  Idle --> Detached: socket closes and no subscribers remain
  Detached --> Restored: session/restore
  Restored --> Running: new prompt
  Idle --> Deleted: session/delete
  Detached --> Deleted: session/delete
  Running --> Deleted: stale owner detects deleted row
  Deleted --> [*]
```

Session rules:

| Area               | Contract                                                              |
| ------------------ | --------------------------------------------------------------------- |
| Empty sessions     | Not persisted and have no workspace number.                           |
| Workspace sequence | Assigned on the first user prompt for the resolved `cwd`.             |
| Restore selector   | Accepts the full session id or workspace sequence number.             |
| Ownership          | Stored in `session_owners`; prompt handling claims ownership.         |
| Stale output       | Discarded when another server owns the session before completion.     |
| Delete             | Soft deletes session, clears owner, and forces stale owners to close. |

## Runtime Event Pipeline

```mermaid
sequenceDiagram
  participant CLI
  participant Server as SessionServer
  participant Runtime as AgentRuntime
  participant Loop as runAgent
  participant Model as ModelClient
  participant Tools as ToolRegistry
  participant DB as SQLite

  CLI->>Server: turn/start { sessionId, prompt }
  Server->>DB: create session row if first prompt
  Server->>Runtime: submit user prompt
  Runtime-->>Server: session_configured if new runtime
  Runtime-->>Server: turn_started
  Server->>DB: append event
  Server-->>CLI: turn/started
  Runtime->>Loop: runAgent(history, config, tools)
  Loop->>Model: sample local conversation stack
  alt model returns tool calls
    Loop->>Tools: execute calls in workers
    Tools-->>Loop: function_call_output items
    Loop->>Model: sample with updated stack
  else model returns text
    Model-->>Loop: assistant text
  end
  Runtime-->>Server: agent_message, tool events, token usage
  Server->>DB: append events
  Server-->>CLI: item and usage notifications
  Runtime-->>Server: turn_complete
  Server->>DB: append terminal event
  Server-->>CLI: turn/completed
```

Runtime notification mapping:

| Runtime event        | Socket notification          |
| -------------------- | ---------------------------- |
| `session_configured` | `session/configured`         |
| `turn_started`       | `turn/started`               |
| `agent_message`      | `item/agentMessage`          |
| `tool_call`          | `item/toolCall`              |
| `tool_result`        | `item/toolResult`            |
| `token_count`        | `session/tokenUsage/updated` |
| `turn_complete`      | `turn/completed`             |
| `turn_aborted`       | `turn/aborted`               |
| `warning`            | `warning`                    |
| `error`              | `error`                      |

## Persistence Model

```mermaid
erDiagram
  accounts ||--o{ social_accounts : links
  accounts ||--o{ sessions : owns
  accounts ||--o{ session_owners : claims
  projects ||--o{ sessions : groups
  sessions ||--o{ session_events : records
  sessions ||--o| session_owners : current_owner

  accounts {
    string user_id
    string username
    string password_hash
    number created_at
    number updated_at
  }

  social_accounts {
    string provider
    string subject
    string user_id
    string access_token
    string refresh_token
  }

  projects {
    string id
    string user_id
    string cwd
    number next_sequence
  }

  sessions {
    string id
    string user_id
    string cwd
    number workspace_sequence
    string title
    string status
    number created_at
    number updated_at
    number deleted_at
  }

  session_events {
    string id
    string session_id
    string type
    string payload_json
    number created_at
  }

  session_owners {
    string session_id
    string owner_id
    number claimed_at
  }
```

The store lives at `<dataDir>/ndx.sqlite`. The default data directory is
`/home/.ndx/system`. `dataPath` overrides it; legacy `sessionPath` is accepted
as the same override.

## Config And Bootstrap

```mermaid
flowchart TD
  start["loadConfig(cwd)"]
  bootstrap["ensureGlobalNdxHome\ninstall missing system dirs and core tools"]
  global["Read /home/.ndx/settings.json if present"]
  project["Read current project .ndx/settings.json if present"]
  exists{"At least one settings file?"}
  merge["Merge settings\nglobal first, project overrides"]
  search["Read /home/.ndx/search.json"]
  normalize["Normalize model pools and model catalog"]
  validate["Validate providers and active session pool"]
  loaded["LoadedConfig"]
  fail["Config load error\nsettings wizard may handle only in TTY CLI"]

  start --> bootstrap --> global --> project --> exists
  exists -->|"yes"| merge --> search --> normalize --> validate --> loaded
  exists -->|"no"| fail
```

Settings load order:

1. `/home/.ndx/settings.json`
2. Current project `.ndx/settings.json`
3. `/home/.ndx/search.json` for web-search parsing rules

The bootstrap report is returned by `initialize` and included in
`session/configured`. It records required `.ndx` elements, absolute paths, and
whether each element was installed or already existed.

## Model Routing

```mermaid
flowchart TD
  prompt["User prompt"]
  custom{"Prompt contains @customKey?"}
  customPool["Select model.custom.customKey"]
  sessionPool["Select model.session"]
  bind{"Pool already bound in live session?"}
  reuse["Reuse sticky model binding"]
  choose["Choose model from pool"]
  cache["Provider client cache key\nmodel id, effort, thinking, sampling"]
  provider{"Provider type"}
  responses["OpenAI-compatible\nResponses first"]
  fallback{"404 or 405?"}
  chat["OpenAI-compatible\nChat Completions fallback"]
  anthropic["Anthropic Messages"]
  request["Send full local conversation stack\nno previous_response_id"]

  prompt --> custom
  custom -->|"yes"| customPool --> bind
  custom -->|"no"| sessionPool --> bind
  bind -->|"yes"| reuse --> cache
  bind -->|"no"| choose --> cache
  cache --> provider
  provider -->|"openai"| responses --> fallback
  fallback -->|"yes"| chat --> request
  fallback -->|"no"| request
  provider -->|"anthropic"| anthropic --> request
```

Routing rules:

| Rule                          | Effect                                                  |
| ----------------------------- | ------------------------------------------------------- |
| `model` string                | Normalized to one-entry `model.session`.                |
| `model.session`               | Required for object form.                               |
| `model.custom.<key>`          | Selected by prompts containing `@key`.                  |
| Sticky session binding        | Keeps prefix-cache locality for a live session.         |
| `/model`, `/effort`, `/think` | Explicit provider-client binding boundaries.            |
| Responses API                 | Does not send `previous_response_id`.                   |
| Responses fallback            | `404` and `405` switch that client to Chat Completions. |

## Tool Discovery

```mermaid
flowchart TB
  startup["Session server startup"]
  registry["createToolRegistry"]
  task["Task tools\ninput, planning, collaboration"]
  core["Core filesystem tool packages\n/home/.ndx/system/tools"]
  project["Project tool packages"]
  global["Global tool packages"]
  plugin["Plugin filesystem layers"]
  mcp["MCP tools/list or static tools"]
  schemas["Function-compatible schemas"]
  model["Model request tools[]"]

  startup --> registry
  registry --> task
  registry --> core
  registry --> project
  registry --> global
  registry --> plugin
  registry --> mcp
  task --> schemas
  core --> schemas
  project --> schemas
  global --> schemas
  plugin --> schemas
  mcp --> schemas
  schemas --> model
```

Tool layer rules:

| Layer         | Contract                                                           |
| ------------- | ------------------------------------------------------------------ |
| Task tools    | Built into TypeScript session tool tree.                           |
| Core tools    | External `tool.json` packages installed under `.ndx/system/tools`. |
| Project tools | Filesystem packages with folder name equal to function name.       |
| Global tools  | User-level filesystem packages.                                    |
| Plugin tools  | Discovered from plugin filesystem layer directories.               |
| MCP tools     | Queried with `tools/list` or loaded from static settings.          |

The agent loop only sees normalized function schemas and normalized tool
results. Provider-specific tool block formats do not leak into `src/agent`.

## Tool Execution

```mermaid
sequenceDiagram
  participant Model
  participant Loop as runAgent
  participant Registry as ToolRegistry
  participant Worker as Node worker process
  participant External as External tool command
  participant Docker as Docker sandbox
  participant MCP as MCP stdio server

  Model-->>Loop: tool calls
  Loop->>Registry: execute tool calls in parallel
  Registry->>Worker: spawn one worker per call
  alt task tool
    Worker->>Worker: execute TypeScript task implementation
  else external tool.json
    Worker->>External: run manifest command through runProcess
    alt shell-like and NDX_SANDBOX_CONTAINER present
      External->>Docker: docker exec -w mapped Linux sandbox path
      Docker-->>External: stdout, stderr, exit code
    else normal external command
      External-->>Worker: stdout, stderr, exit code
    end
  else MCP tool
    Worker->>MCP: JSON-RPC stdio call
    MCP-->>Worker: result
  end
  Worker-->>Registry: ToolExecutionResult
  Registry-->>Loop: function_call_output
  Loop->>Model: next sample with updated local stack
```

Execution rules:

| Rule                           | Effect                                                 |
| ------------------------------ | ------------------------------------------------------ |
| One worker per model tool call | Capability tools do not execute in the agent process.  |
| Parallel model tool calls      | Launched in parallel for one model response.           |
| `runProcess`                   | Owns spawn, stdout/stderr capture, timeout, and abort. |
| `shellTimeoutMs`               | Default external timeout unless manifest overrides it. |
| Abort                          | Propagates to worker and immediate external process.   |
| Deep child cleanup             | Owned by the external capability tool implementation.  |

## Docker Sandbox

```mermaid
flowchart TD
  need["Server needs shell-like tool execution for workspace"]
  image["Pinned image\nhika00/ndx-sandbox:0.1.0"]
  checkDocker{"Docker available?"}
  pullOrUse["Use or pull pinned image"]
  container{"Workspace sandbox container exists?"}
  create["Create container\nmount project folder as workspace volume"]
  ready["Expose NDX_SANDBOX_CONTAINER to shell-like tools"]
  fail["Warn and exit server\nCLI shows same warning and exits"]
  tool["shell-like external tool"]
  exec["docker exec against sandbox"]

  need --> checkDocker
  checkDocker -->|"no"| fail
  checkDocker -->|"yes"| pullOrUse --> container
  container -->|"yes"| ready
  container -->|"no"| create --> ready
  ready --> tool --> exec
```

The root `docker-compose.yml` is a deploy verification harness for the sandbox
image. It is not the production server owner.

```mermaid
sequenceDiagram
  participant Dev as Developer
  participant Deploy as npm run deploy
  participant Build as TypeScript build and tests
  participant Compose as docker compose
  participant Sandbox as ndx-sandbox

  Dev->>Deploy: npm run deploy
  Deploy->>Build: yarn build
  Deploy->>Build: yarn test
  Deploy->>Compose: down --remove-orphans
  Deploy->>Compose: build --no-cache ndx-sandbox
  Deploy->>Compose: up -d ndx-sandbox
  Deploy->>Sandbox: docker exec write /workspace/tmp/ndx-docker-verify.txt
  Deploy->>Compose: down --remove-orphans
```

Sandbox release rule:

```mermaid
flowchart LR
  change["Change sandbox Dockerfile or runtime contract"]
  build["Build image"]
  tag["Tag under hika00 with new version"]
  push["Push to Docker Hub"]
  pin["Update server pin if needed"]
  verify["Verify server against pushed tag"]
  merge["Merge only after pushed-tag verification"]

  change --> build --> tag --> push --> pin --> verify --> merge
```

## Interrupt And Error Flow

```mermaid
sequenceDiagram
  participant Client
  participant Server
  participant Runtime as AgentRuntime
  participant Worker
  participant External as External command
  participant DB as SQLite

  Client->>Server: turn/interrupt { sessionId, reason }
  Server->>Runtime: abort current turn
  Runtime->>Runtime: abort turn AbortController
  Runtime->>Worker: signal worker process
  Worker->>External: abort runProcess command
  Runtime-->>Server: turn_aborted
  Server->>DB: append abort event
  Server-->>Client: turn/aborted
```

Model and runtime errors are classified as `unauthorized`, `bad_request`,
`rate_limited`, `server_error`, `connection_failed`, or `unknown`. Consumers
receive normalized `error` notifications rather than provider-specific error
objects.

## Dashboard Boundary

```mermaid
flowchart LR
  browser["Browser"]
  http["Dashboard HTTP listener"]
  page["Server dashboard\nmain landmark named Server Dashboard\nReload and Exit buttons\ndata-testid=ndx-dashboard"]
  socket["Authenticated WebSocket JSON-RPC"]
  note["Agent control remains socket-first"]

  browser -->|"GET / or /dashboard"| http --> page
  page -->|"POST /api/reload"| http
  page -->|"POST /api/exit"| http
  page -.-> note -.-> socket
```

The dashboard has no authentication or authorization. Agent interaction remains
socket-first.

## Package And Release Channels

```mermaid
flowchart TD
  source["Root TypeScript package"]
  build["yarn build"]
  dist["dist/src"]
  files["npm package files\ndist/src, README.md, LICENSE, NOTICE"]
  verdaccio["Default test channel\nVerdaccio\nhttps://verdaccio.neurondev.net"]
  npmjs["Explicit public release only\nnpmjs\nhttps://registry.npmjs.org"]
  install["npm install -g @neurondev/ndx"]
  bins["ndx and ndxserver bins"]

  source --> build --> dist --> files
  files --> verdaccio
  files --> npmjs
  verdaccio --> install
  npmjs --> install
  install --> bins
```

Current published package contract:

| Field                                    | Value                                        |
| ---------------------------------------- | -------------------------------------------- |
| Package                                  | `@neurondev/ndx`                             |
| Version                                  | `0.1.10`                                     |
| Binaries                                 | `ndx`, `ndxserver`                           |
| Packed files                             | `dist/src`, `README.md`, `LICENSE`, `NOTICE` |
| Local global prefix used in verification | `/home/hika/.local`                          |

Release policy: publish testable builds to Verdaccio by default. Publish to
public npm only when explicitly requested.

## End-To-End Turn

```mermaid
flowchart TD
  start["User runs ndx"]
  probe["Probe socket address"]
  fallback{"Server reachable?"}
  local["Start local server if missing"]
  login["Login immediately"]
  init["Initialize and receive bootstrap"]
  sandbox["Server ensures Docker sandbox"]
  settings{"Settings available?"}
  wizard["Settings wizard creates /home/.ndx/settings.json"]
  project["Use current folder as project"]
  session["Start or restore session"]
  prompt["User prompt"]
  runtime["AgentRuntime turn"]
  model["Provider sample"]
  tools{"Tool calls?"}
  worker["Worker and external tools"]
  docker["Docker exec for shell-like tools"]
  output["Assistant message and stored events"]

  start --> probe --> fallback
  fallback -->|"yes"| login
  fallback -->|"no"| local --> login
  login --> init --> sandbox --> settings
  settings -->|"yes"| project
  settings -->|"no and TTY"| wizard --> project
  project --> session --> prompt --> runtime --> model --> tools
  tools -->|"yes"| worker --> docker --> model
  tools -->|"no"| output
  model --> output
```

## Current Non-Goals

- Docker compose does not host the ndx server.
- The dashboard is not a full UI yet.
- Authorization beyond authenticated user scoping is not implemented yet.
- `model.worker` and `model.reviewer` are validated but not consumed by runtime
  dispatch yet.
- Multi-agent and agent-job task tools remain unavailable until their
  TypeScript backends are implemented.
- Provider-side response continuation state is intentionally unused.
