# Test Plan: local-server-docker-sandbox

## Created

2026-05-02

## Goal

Verify that ndx starts as a local socket server, uses login before
initialization, manages Docker only as a per-workspace tool sandbox, and keeps
the sandbox image deployable from Docker Hub.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Runtime: Node.js 22, Yarn 4, Docker Compose
- Sandbox image: `hika00/ndx-sandbox:0.1.1`

## Preconditions

- Docker daemon is available.
- Docker Hub credentials for `hika00` are available locally when pushing the
  sandbox image.
- Project dependencies are installed through the repository Yarn contract.

## Steps

1. Run `yarn build`.
2. Run `yarn test`.
3. Run `npm run deploy`.
4. Push `hika00/ndx-sandbox:0.1.1`.
5. Pull `hika00/ndx-sandbox:0.1.1`.
6. Start a `SessionServer` with `requireDockerSandbox: true` and
   `tools.dockerSandboxImage` set to the pushed tag.
7. Fetch the dashboard URL from that local server.
8. Remove the generated sandbox container.

## Expected Results

- TypeScript build succeeds.
- Node test suite passes.
- Deploy removes prior compose containers, builds `ndx-sandbox`, starts it,
  writes `/workspace/tmp/ndx-docker-verify.txt`, and tears compose down.
- Docker Hub push succeeds for the pinned image tag.
- Local server startup creates the workspace sandbox from the pushed tag and
  dashboard fetch returns HTTP 200.

## Logs To Capture

- Build/test summary.
- Deploy Docker build and compose summary.
- Docker push digest.
- Pushed-tag server verification JSON.

## Locator Contract

- Dashboard verification target: HTTP `GET /dashboard`.
- Expected page contract: one dashboard placeholder with status surface and
  `data-testid="agent-dashboard-placeholder"` as documented in
  `docs/testing.md`.
