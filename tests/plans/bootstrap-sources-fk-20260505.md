# Bootstrap Sources And SQLite FK Plan

## Scope

Verify startup source visibility and first-turn SQLite persistence after a
local account database has legacy v2 user identifiers.

## Steps

1. Expose server-recognized source paths and context-source metadata through the
   `initialize` response.
2. Render a compact CLI source summary during startup, including AGENTS.md and
   skill groups.
3. Change the session schema so `session.userid` references `users.userid`.
4. Migrate v2 session tables in place before the first session insert.
5. Add regression tests for CLI startup source output and legacy v2 account rows.
6. Run targeted config, runtime, CLI, and session-server tests, then the full
   build/test/deploy verification.

## Expected Results

- Bootstrap output still reports installed/existing global elements.
- Startup output also reports loaded settings, AGENTS.md, and skills sources.
- First prompt from a database containing `id = defaultUser` and
  `userid = defaultuser` does not fail with a foreign-key error.
- `/context` source accounting remains grouped as project/user AGENTS.md and
  skills.
