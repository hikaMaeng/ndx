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
- No runtime environment variable selects model, provider URL, provider key, or
  ndx home.
- `NDX_SANDBOX_IMAGE` may override the sandbox image for explicit verification.
- `NDX_CLI_STATE_DIR` may move host CLI app state.
- Settings version must match the installed package version.
- Secrets must not be committed to repository files.

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

## Dashboard Markup Contract

The browser surface is the dashboard at `GET /` and `GET /dashboard`.

- One `main` landmark: `main[aria-labelledby="dashboard-title"]`.
- Stable root hook: `data-testid="ndx-dashboard"`.
- Action navigation: `nav aria-label="Server actions"`.
- Buttons named `Reload` and `Exit`.
- Action result uses `role="status"` and may switch to `role="alert"`.
- Stable hooks: `dashboard-action-status`, `dashboard-sources`,
  `dashboard-bootstrap`.
- Browser tests must prefer role, label, text, and documented test ids over CSS
  class or DOM-depth selectors.
