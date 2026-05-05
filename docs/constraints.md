# Constraints

## Runtime Defaults

- Code-owned defaults live in `src/config/defaults.ts`.
- The default host is `127.0.0.1`.
- The managed socket and dashboard ports are `45123` and `45124`.
- The global runtime directory is `/home/.ndx`.
- The sandbox workspace and global mounts are `/workspace` and `/home/.ndx`.
- The default sandbox image is `hika00/ndx-sandbox:0.1.1`.

## Settings

- Runtime model/provider/key configuration is JSON-only.
- AGENTS.md cascading is limited to project `AGENTS.md`, project
  `.ndx/AGENTS.md`, and user-home `.ndx/AGENTS.md`.
- Skill discovery is limited to project `.ndx/skills`, project
  `.ndx/plugins/*/skills`, user-home `.ndx/skills`, user-home
  `.ndx/plugins/*/skills`, and user-home `.ndx/system/skills`.
- `skills/.system` is not a valid skill discovery location.
- No runtime environment variable selects model, provider URL, provider key, or
  ndx home.
- `NDX_SANDBOX_IMAGE` may override the sandbox image for explicit verification.
- `NDX_CLI_STATE_DIR` may move host CLI app state.
- Settings version must match the installed package version.
- Secrets must not be committed to repository files.
- AGENTS.md project traversal stops at the detected project root. The default
  root marker is `.git`; `projectRootMarkers` may narrow or disable traversal.
- Skill `SKILL.md` files must use YAML frontmatter. Ambiguous plain `$skill`
  names are not injected; use a concrete `SKILL.md` link when duplicate names
  exist.

## Server And Sandbox

- The ndx server is a host process, not a Docker service.
- Docker is only the external tool and MCP stdio sandbox.
- Session visibility is scoped by `userid` plus `projectid`, not by path alone.
- Project ids come from `<project>/.ndx/.project`; path reuse after deleting
  that file is a new project scope.
- Session ownership is a client UUID contract. A client that sees a different
  persisted `ownerid` must claim ownership and reload persisted context before
  updating the session.
- Session persistence must use only `session` and `sessiondata`; legacy
  session-domain tables are reset out of the schema.
- Sandbox Dockerfile or runtime contract changes require a new Docker Hub tag
  under `hika00`, a pushed image, and server verification against that tag.
- External tool audit records are written under
  `/home/.ndx/system/logs/tool-executions.jsonl` in the sandbox.

## Local Accounts

- Accounts are local SQLite rows in `users`; OAuth account creation is not a
  supported login path.
- Canonical account ids are lowercase ASCII letters and digits only.
- Account creation takes only `username`; passwords, social tokens, deletion,
  and password changes are outside the runtime contract.
- `defaultuser` is protected and cannot be blocked or unblocked.
- Blocked accounts cannot log in. Blocking the current account closes that
  connected client session.
- Previous-login selection is server-owned: the non-blocked account with the
  greatest `lastlogin` wins.

## Dashboard Markup Contract

The browser surface is the dashboard at `GET /` and `GET /dashboard`.

- One `main` landmark: `main[aria-labelledby="dashboard-title"]`.
- Stable root hook: `data-testid="ndx-dashboard"`.
- View navigation: `nav aria-label="Dashboard views"` with buttons named
  `Overview`, `Session Logs`, and `Users`.
- Action navigation: `nav aria-label="Server actions"`.
- Buttons named `Reload` and `Exit`.
- Action result uses `role="status"` and may switch to `role="alert"`.
- Stable hooks: `dashboard-action-status`, `dashboard-sources`,
  `dashboard-bootstrap`, `dashboard-server-stats`, `dashboard-session-logs`,
  `session-log-table`, `session-log-row`, `session-log-detail`,
  `session-log-events`, `dashboard-users`, `users-table`, and
  `dashboard-user-row`.
- Session logs and session detail are separate right-main views. Opening a
  session replaces the session table body with the session detail view instead
  of appending details below the main overview.
- Browser tests must prefer role, label, text, and documented test ids over CSS
  class or DOM-depth selectors.
