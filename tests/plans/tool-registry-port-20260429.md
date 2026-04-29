# Tool Registry Port Test Plan

## Goal

Verify that the TypeScript agent exposes Rust Codex default tools through a registry and supports configured MCP/plugin tool schemas.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Runtime: Node.js TypeScript package
- Date created: 2026-04-29

## Preconditions

- Dependencies installed.
- No browser UI is involved.
- Static MCP/plugin test fixtures are provided through in-memory `NdxConfig`.

## Steps

1. Run `npm test`.
2. Confirm TypeScript compilation passes.
3. Confirm existing mock agent still executes the local shell tool.
4. Confirm registry exposes default Rust Codex-compatible tools.
5. Confirm registry exposes configured MCP and plugin tools with namespaced names.

## Expected Results

- `npm test` exits with code 0.
- The default registry includes shell, exec, patch, plan, filesystem, MCP resource, collaboration placeholder, and discovery tools.
- Configured MCP and plugin tools appear as callable function schemas.

## Logs To Capture

- Full `npm test` TAP summary.
