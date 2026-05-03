# Skills

ndx bootstraps a global skills directory under `/home/.ndx/system/skills`.

## Runtime Contract

- Missing global skill directories are installed during `.ndx` bootstrap.
- The bootstrap report lists installed or existing skill paths in
  `initialize` and `session/configured`.
- Skill files are local runtime assets. They are not copied into prompt context
  unless a client or tool explicitly reads and uses them.

## Ownership

Core skill bootstrapping is owned by `ensureGlobalNdxHome` in `src/config`.
Session clients display bootstrap status only; the session server remains the
authority for which skill sources were discovered.
