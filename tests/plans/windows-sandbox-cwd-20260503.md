# Test Plan: windows-sandbox-cwd

## Scope

Verify that Windows host paths are converted to Linux container paths before
tool execution uses Docker `exec -w`, and that file-changing tool failures are
not presented as manual copy/save workarounds.

## Steps

1. Build TypeScript with `yarn build`.
2. Run focused tests:
   `node --test dist/tests/cli-workspace.test.js dist/tests/model-adapters.test.js dist/tests/tools.test.js dist/tests/tool-orchestration.test.js`.
3. Run `yarn test`.
4. Run `npm run deploy`.
5. Publish `@neurondev/ndx@0.1.10` to Verdaccio.
6. Install `@neurondev/ndx@0.1.10` from Verdaccio into an isolated prefix and
   verify both installed binaries report `0.1.10`.

## Expected

- `F:\dev\test1` maps to `/workspace`.
- `F:\dev\test1\src\index.html` maps to `/workspace/src/index.html`.
- `C:\Users\hika0\.ndx\system\tools\apply_patch` maps to
  `/home/.ndx/system/tools/apply_patch`.
- Unmapped Windows absolute paths fall back to `/workspace`, never to a
  container-invalid `C:\...` or `F:\...` `docker exec -w` value.
- Provider instructions tell models to retry/report tool failures instead of
  asking the user to copy files manually.
