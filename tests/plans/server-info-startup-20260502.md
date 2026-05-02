# Test Plan: server-info-startup

## Scope

Verify that CLI startup prints connected server identity before the login prompt
and that the public socket method exposes only server/runtime/sandbox identity.

## Steps

1. Build TypeScript with `yarn build`.
2. Run focused CLI and session-server tests:
   `node --test dist/tests/cli-session-client.test.js dist/tests/session-server.test.js`.
3. Run the full repository test suite with `yarn test`.
4. Run `npm run deploy` to rebuild, test, refresh compose, and verify the
   Docker sandbox path.
5. Publish `@neurondev/ndx@0.1.9` to Verdaccio.
6. Install `@neurondev/ndx@0.1.9` from Verdaccio into an isolated prefix and
   verify both installed binaries report `0.1.9`.

## Expected

- CLI output includes `[session-server] ndx-ts-session-server 0.1.9`,
  `[server-runtime] ...`, `[tool-sandbox] ...`, `[dashboard] ...`, and
  `[protocol] 1` before `login>`.
- `initialize` still provides methods and compact bootstrap after login.
- `server/info` works without prior account login.
- Deploy, publish, and isolated install verification pass.
