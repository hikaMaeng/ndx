# Tool Layer System Verification Plan

Date: 2026-04-29

## Scope

- Replace agent-owned capability tools with `tool.json` filesystem discovery.
- Preserve only task orchestration tools as internal agent tools.
- Enforce layer priority: task, core, project, global, project plugin, global plugin, project MCP, global MCP.
- Run every model tool call through an isolated Node worker process.

## Commands

```bash
npm test
```

## Expected

- Registry exposes task tools without filesystem packages.
- Filesystem `tool.json` tools are discovered by layer.
- Higher-priority duplicate names win.
- Project MCP wins over global MCP for duplicate names.
- Parallel tool calls use distinct worker Node parent processes.
