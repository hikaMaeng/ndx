# Test Plan: remove-native-traces

## Created

2026-04-29

## Goal

Verify the repository no longer contains legacy native source, workspace, CI,
packaging, or documentation assets outside the TypeScript ndx product tree.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Shell: bash
- Runtime: Node and npm from the active environment

## Preconditions

- Legacy native directories and files are removed from the working tree.
- TypeScript workspace configuration is updated to include only active packages.

## Steps

1. Search the repository, excluding `node_modules`, `dist`, and `.git`, for
   legacy native source and release markers.
2. Search for legacy native source manifests and source files outside ignored
   generated directories.
3. Build the TypeScript project with `npm run build`.
4. Run the TypeScript test suite with `npm test`.

## Expected Results

- Repository search returns no active matches.
- No legacy native source, manifest, or toolchain files remain in the working
  tree.
- TypeScript build passes.
- TypeScript tests pass.

## Logs To Capture

- Search commands and whether they returned matches.
- Build and test command summaries.

## Locator Contract

No browser verification applies to this repository cleanup.
