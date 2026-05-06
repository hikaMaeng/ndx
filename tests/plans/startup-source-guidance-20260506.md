# Startup Source Guidance - 2026-05-06

## Goal

Reduce max-turn waste after startup by making the loaded-source contract
explicit to the model: AGENTS.md and skill catalog source paths are already in
context, and skill requests should start with `load_skill`.

## Scope

1. Strengthen available-skill instructions.
2. Document that `load_skill` should precede filesystem or shell exploration
   for skill-driven requests.
3. Add a config regression assertion for the stronger instruction text.
4. Publish and Windows-install-test the patched package from Verdaccio.

## Verification

- TypeScript compile.
- Prettier check.
- Targeted config and skill tests.
- Full `yarn test`.
- `npm run deploy`.
- Verdaccio publish and Windows global install verification.
- Windows `F:\dev\test2` `ndxserver` and `ndx --connect` skill-load scenario.
