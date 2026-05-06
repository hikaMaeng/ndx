# Remove Unavailable Input Tool Exposure - 2026-05-06

## Goal

Prevent the non-interactive TypeScript runtime from offering
`request_user_input` to the model. The runtime cannot satisfy that tool, so it
must not appear in model-facing schemas during real sessions.

## Scope

1. Remove `request_user_input` from built-in task tool registration.
2. Keep `list_skills` and `load_skill` available for host-side skill body
   loading.
3. Update tests that assert the internal task tool list.
4. Document that unavailable interactive input is excluded from the runtime
   schema.
5. Publish and install-test the patched package from Verdaccio.

## Verification

- TypeScript compile.
- Prettier check.
- Targeted tool registry and orchestration tests.
- Targeted skill loading tests.
- Full `yarn test`.
- `npm run deploy`.
- Verdaccio publish and install scenario confirming `request_user_input` is not
  in model tool schemas while `load_skill` is present.
