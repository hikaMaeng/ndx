# Usage

## Development

```bash
yarn install --immutable
yarn build
yarn test
```

Yarn uses Plug'n'Play; do not add a workspace `node_modules` tree.

## Local Run

```bash
node dist/src/cli/main.js --mock "list files"
```

Mock mode starts an embedded loopback server and uses `MockModelClient`.

Run the normal managed CLI:

```bash
node dist/src/cli/main.js
```

The CLI tries `ws://127.0.0.1:45123`. If unreachable, it starts a local server
for the current folder as a detached `ndxserver` process, waits for the
WebSocket endpoint, prints server info, logs in, and offers session selection.
Exiting the CLI does not stop that managed server; stop it with a process
signal or the dashboard `Exit` action. Windows, macOS, and Linux use separate
background launcher paths so CLI exit is not the server lifetime owner. On
Windows, plain `ndxserver` is a background server trigger; use `ndxserver serve`
only when you explicitly want a foreground server terminal. Windows starts the
current Node entrypoint directly as a hidden detached process and captures
stdout/stderr in `%TEMP%\ndx-managed-server-host.log` when possible. The
published `ndxserver` bin uses a dedicated bootstrap so Windows npm shims do not
have to preserve the original command name in `process.argv[1]`. Managed
servers ignore terminal shutdown signals, including `SIGINT`, `SIGTERM`,
`SIGHUP`, and `SIGBREAK`, so leaving a client does not stop the background
server. The CLI also prints detached launcher selection, command metadata,
server args, spawned pid, readiness probe attempts, failing stage, and last
error. Inability to write logs does not block server startup.

Startup login is local-only. The server bootstraps `defaultuser`, selects the
previous account from SQLite `users.lastlogin`, and offers local account
creation in interactive mode. New user ids contain only letters and digits and
are stored lowercase. `/login` creates or switches local ids. `/blockuser <id>`
blocks a non-protected id; `/unblockuser <id>` restores it. Blocking the
currently connected id ends that client session. Accounts are not deleted.

Stop the managed server explicitly:

```bash
ndxserver stop
```

Run the server explicitly when you want to own its terminal:

```bash
ndxserver serve --cwd /path/to/project --listen 127.0.0.1:45123 --dashboard-listen 127.0.0.1:45124
```

## Settings

Use `/home/.ndx/settings.json` for global settings. Use
`<project>/.ndx/settings.json` only when a project override is needed. Every
settings file must contain `"version"` equal to the installed package version;
valid stale files are version-bumped in place.

Instruction files cascade separately from settings. At startup ndx reads
project `AGENTS.md`, project `.ndx/AGENTS.md`, and user-home
`.ndx/AGENTS.md` when present. Skill catalogs are scanned from project
`.ndx/skills`, project `.ndx/plugins/*/skills`, user-home `.ndx/skills`,
user-home `.ndx/plugins/*/skills`, and user-home `.ndx/system/skills`.
`skills/.system` is not scanned. `/context` reports AGENTS.md and skill catalog
token estimates separately from conversation messages.

Minimal shape:

```json
{
  "version": "0.1.30",
  "model": "local-model",
  "providers": {
    "local": {
      "type": "openai",
      "key": "",
      "url": "http://localhost:1234/v1"
    }
  },
  "models": [{ "name": "local-model", "provider": "local" }],
  "keys": {}
}
```

`model` may also be a pool object with `session`, `worker`, `reviewer`, and
`custom` entries. MCP servers are declared under `mcp`. Tool packages are
filesystem packages, not settings entries.

AGENTS.md loading follows the detected project root. At startup ndx reads
project `AGENTS.md`, project `.ndx/AGENTS.md`, and user-home
`/home/.ndx/AGENTS.md` in that order. `AGENTS.override.md` and nested
per-directory AGENTS files are not part of the cascade.

Optional AGENTS.md settings:

```json
{
  "projectDocMaxBytes": 32768,
  "projectRootMarkers": [".git"]
}
```

Skills live in `SKILL.md` files under `<project>/.ndx/skills`,
`<project>/.ndx/plugins/*/skills`, `/home/.ndx/skills`,
`/home/.ndx/plugins/*/skills`, or `/home/.ndx/system/skills`. Each skill
requires YAML frontmatter with at least a useful `description`. Mention a skill
with `$skill-name`; when names are ambiguous, link the exact path:

```text
[$repo-skill](/path/to/project/.ndx/skills/repo-skill/SKILL.md) run the workflow
```

## Docker Sandbox

The default sandbox image is `hika00/ndx-sandbox:0.1.1`. Override it only for
explicit verification:

```bash
NDX_SANDBOX_IMAGE=hika00/ndx-sandbox:0.1.1 ndx
```

External tools see the project as `/workspace` and global state as
`/home/.ndx`.

## Deploy

```bash
npm run deploy
```

Deploy runs the local TypeScript build and tests, removes prior compose
resources, rebuilds `ndx-sandbox`, starts it, verifies a file write in
`/workspace/tmp`, and tears the compose stack down.

## Install Test

```bash
npm publish --registry https://verdaccio.neurondev.net/
npm install -g @neurondev/ndx@<version> --registry https://verdaccio.neurondev.net/
ndx --version
ndxserver --version
```

Public npm publishing is not part of normal completion unless explicitly
requested.
