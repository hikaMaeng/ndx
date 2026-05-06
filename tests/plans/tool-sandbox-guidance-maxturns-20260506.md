# Tool Sandbox Guidance And Max Turns - 2026-05-06

## Goal

Keep interactive sessions alive when an agent turn reaches `maxTurns`, and make
the Docker tool namespace explicit to models so Windows host paths are not mixed
with Linux sandbox commands.

## Scope

1. Convert max-turn exhaustion from a thrown runtime error into a warning plus a
   completed turn.
2. Forward agent warning events through runtime notifications.
3. Strengthen operational and core tool descriptions for Docker sandbox path and
   shell semantics.
4. Publish and Windows-install-test the patched package from Verdaccio.

## Verification

- TypeScript compile.
- Prettier check.
- Targeted agent/runtime/session tests for max-turn handling.
- Targeted tool schema/config tests for sandbox guidance.
- Full `yarn test`.
- `npm run deploy`.
- Verdaccio publish and Windows global install verification.
- Windows `F:\dev\test2` skill/tool scenario.
