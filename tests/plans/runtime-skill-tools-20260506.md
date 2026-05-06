# Runtime Skill Tool Plan

## Scope

Fix skill usage during live sessions when the model needs a skill body but the
workspace tools run inside the Linux Docker sandbox.

## Steps

1. Add host-side built-in `list_skills` and `load_skill` task tools.
2. Resolve skills from the already-loaded catalog by unique name or canonical
   `SKILL.md` path.
3. Update available-skill instructions so models use `load_skill` instead of
   shell commands for skill files.
4. Keep skill tool calls excluded from restored model context.
5. Lower `request_user_input` discoverability in this non-interactive runtime.
6. Add regression coverage for loading a skill body through the built-in tool.
7. Run targeted agent/runtime/tool/config tests, full test, deploy, Verdaccio
   publish, and installed-package startup scenarios.

## Expected Results

- A prompt such as "use skills to scaffold a web project" can load
  `web-service-scaffold` through `load_skill` without shell path translation.
- Windows host `SKILL.md` paths are no longer opened through bash `type`,
  `cat`, or PowerShell commands inside the sandbox.
- Skill tool audit rows remain persisted but are not restored into future model
  context.
- Startup source reporting remains unchanged.
