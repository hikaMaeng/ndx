# Test Plan: fixskillandagents

## Scope

Verify AGENTS.md and skill discovery now follow the requested cascading
contract, and that context reporting separates project-owned and user-owned
instruction sources.

## Implementation Plan

1. Replace ancestor-wide AGENTS.md scanning with the explicit cascade:
   project `AGENTS.md`, project `.ndx/AGENTS.md`, then user-home
   `.ndx/AGENTS.md`.
2. Add skill catalog scanning in this order:
   project `.ndx/skills`, project `.ndx/plugins/*/skills`, user-home
   `.ndx/skills`, user-home `.ndx/plugins/*/skills`, and user-home
   `.ndx/system/skills`.
3. Do not scan or special-case `skills/.system`; system skills live under
   user-home `.ndx/system/skills`.
4. Include skill catalog entries in stable startup instructions so compacted
   session history does not hide the available skill list.
5. Add context-source metadata for AGENTS.md and skill catalogs, grouped as
   project or user sources, so `/context` can show their token estimates
   separately from conversation history.
6. Exclude skill-loading tool call/result rows from provider-facing persisted
   context regardless of lite mode while preserving them in SQLite audit rows.
7. Update README and docs for the new AGENTS, skills, lite, compact, and
   context contracts.
8. Verify installed server disconnect handling because SessionClient close/reset
   is part of the post-publish scenario run.

## Verification

1. `yarn build`
2. Targeted config and session tests for AGENTS, skills, context, lite, and
   compact behavior.
3. Full `yarn test`.
4. `npm run deploy`.
5. Browser or HTTP verification against a deployed local server where the
   dashboard exposes recognized source paths.
6. Verdaccio publish/install verification and installed `ndxserver` scenario
   checks before PR creation.
7. Installed SessionClient close/reset check confirms the server stays
   reachable after client disconnect.
