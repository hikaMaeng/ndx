# Windows Command Path Mapping - 2026-05-06

## Goal

Make the active Windows project path and Docker workspace mount behave as the
same filesystem root, including host paths embedded inside `shell.command`
strings.

## Scope

1. Add code-level text rewriting for embedded host workspace/global paths before
   external tool arguments are sent into the Docker sandbox.
2. Preserve existing structured path mapping for `cwd`, `dir_path`, and runtime
   arguments.
3. Verify commands such as `mkdir -p F:/dev/test2/apps/...` execute under
   `/workspace/apps/...` instead of creating `F:` or `F0` folders.

## Verification

- TypeScript compile.
- Prettier check.
- Targeted sandbox path mapping tests.
- Full `yarn test`.
- `npm run deploy`.
- Verdaccio publish and Windows global install verification.
- Windows `F:\dev\test2` shell-command smoke test against the installed server.
