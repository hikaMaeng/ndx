# Test Plan: Compose Service Default

## Scope

Verify that the Docker Compose service starts the agent server by default,
publishes separate socket and dashboard ports, logs runtime service addresses,
and remains reachable through the host-published ports.

## Steps

1. Run `docker compose config`.
2. Run `yarn test`.
3. Push the feature branch because `npm run deploy` builds from the remote
   branch named by `NDX_GIT_REF`.
4. Run `npm run deploy`.
5. Run `docker compose up -d ndx-agent`.
6. Inspect `docker compose logs --tail 120 ndx-agent`.
7. Run `docker compose ps`.
8. Fetch `http://127.0.0.1:45124/dashboard`.
9. Connect through `ws://127.0.0.1:45123` from inside the service container
   with `ndx --mock --connect ws://127.0.0.1:45123 "..."`.
10. Run `docker compose down --remove-orphans`.

## Expected Results

- Compose config contains published socket and dashboard ports.
- Startup logs include `[ndx-image]` provenance and `[ndx-service]` bind/URL
  lines.
- On an empty `/home/.ndx` compose volume, startup does not copy repository
  settings; the default service uses `--mock` for compose wiring verification.
- The service process is `ndxserver`, not `sleep infinity`.
- Dashboard locator contract is reachable through the published dashboard port.
- A CLI client can connect through the published socket port.
- Deploy still completes image build, in-container tests, mock agent
  verification, and compose cleanup.
