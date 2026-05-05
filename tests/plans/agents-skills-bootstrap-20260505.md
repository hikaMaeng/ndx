# AGENTS.md And Skills Bootstrap Plan

## Source Review

- Upstream Rust Codex implements AGENTS.md discovery in
  `codex-rs/core/src/agents_md.rs`.
- Global instructions are loaded from `$CODEX_HOME/AGENTS.override.md` first,
  then `$CODEX_HOME/AGENTS.md`.
- Project instructions are discovered from the project root to the session cwd.
  The root is found with project markers, defaulting to `.git`; traversal does
  not continue above that root.
- For each directory in that chain, `AGENTS.override.md` wins over
  `AGENTS.md`, and configured fallback filenames are considered only after
  those two names.
- The model-visible project block is formatted as AGENTS.md instructions and
  source files are recorded separately for session configuration events.
- Upstream skills are implemented across `codex-rs/core-skills`. The loader
  discovers `SKILL.md` files under system, admin, repo, user, plugin, and
  extra roots; parses YAML frontmatter; sorts by scope and name; and dedupes by
  canonical `SKILL.md` path.
- The model receives a compact available-skills list. Full `SKILL.md` content is
  loaded only for explicitly mentioned skills. Structured skill inputs resolve
  by path first; plain `$skill-name` mentions resolve only when unambiguous.

## Current ndx Gap

- `loadConfig()` reads `AGENTS.md` by walking all ancestors to filesystem root,
  so it can include unrelated parent instructions and misses global
  `$NDX_HOME/AGENTS.md`.
- `AGENTS.override.md`, fallback filenames, byte budgets, and instruction
  source fidelity are absent.
- Bootstrap only ensures `system/skills`; it does not expose the standard
  `$NDX_HOME/skills` user skill root.
- No skill discovery, metadata summary, explicit skill content injection, or
  duplicate suppression exists in the agent loop.

## Implementation

1. Add config support for AGENTS.md project-doc options:
   `projectDocMaxBytes`, `projectDocFallbackFilenames`, and
   `projectRootMarkers`.
2. Replace the ancestor-to-root AGENTS.md scan with an upstream-compatible
   resolver:
   global override/global AGENTS, project-root-to-cwd cascading,
   per-directory override preference, fallbacks, max byte budget, and source
   path reporting.
3. Add lightweight skill support:
   scan `$NDX_HOME/skills`, `$NDX_HOME/system/skills`, project `.ndx/skills`,
   and cascading `.agents/skills`;
   parse YAML frontmatter for `name`, `description`, and
   `metadata.short-description`;
   sort and dedupe by canonical `SKILL.md` path;
   render an available-skills summary in model instructions.
4. Extend the agent loop to collect explicit `$skill` and linked
   `[$skill](.../SKILL.md)` mentions from the user prompt, inject full
   `SKILL.md` contents before the turn prompt, and avoid duplicate injections.
5. Record skill roots and AGENTS.md sources in session configuration data so
   `/init`, dashboard reload, and event records reflect real bootstrap state.

## Tests

- Config tests will verify global AGENTS override precedence, project-root
  cascade, nested override precedence, fallback filenames, source paths, and
  byte budgeting.
- Config tests will create global and project skills, including duplicate
  paths and ambiguous names, then verify the available-skills summary and
  source recording.
- Agent-loop tests will verify explicit skill injection by name, linked path
  injection, duplicate suppression, and ambiguous-name non-selection.
- Session-server tests will verify reload/start events expose AGENTS and skill
  sources.

## Verification

- Run focused tests while iterating.
- Run `yarn build`, `yarn test`, and `npm run deploy`.
- Create a test report under `tests/reports/agents-skills-bootstrap/`.
