# Constraints

- Do not import from `apps/*`.
- Keep app wrappers thin; put CLI/server/dashboard behavior here.
- Keep dashboard markup testable by role, accessible name, and documented
  `data-testid` anchors.
- Keep tool execution under `src/tools`; session code may wire tools but should
  not own the tool registry implementation.
- Keep model routing independent from direct settings loading; pass resolved
  model configuration in from orchestration code.

