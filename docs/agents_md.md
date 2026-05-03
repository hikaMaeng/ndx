# AGENTS.md

ndx reads repository instructions from `AGENTS.md` files discovered from the
current working directory ancestry.

## Contract

- Instructions are source context for later sessions after dashboard Reload or
  server startup.
- The session server owns discovery and includes recognized instruction sources
  in `session/configured`.
- Clients display source paths but must not append startup details back into
  prompt context.

## Scope

Use the repository root `AGENTS.md` for repo-wide constraints. Put detailed,
repeatable procedures in skills or docs rather than expanding `AGENTS.md` with
long task formats.
