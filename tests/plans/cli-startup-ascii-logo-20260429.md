# Test Plan: cli-startup-ascii-logo
## Created
2026-04-29

## Goal
Verify that `ndx` startup prints robot-shaped ASCII art combined with uppercase `NDX` before socket/session output.

## Environment
- OS shell: bash
- Runtime: Node.js 22 through package scripts
- Package: root `ndx`

## Preconditions
- Dependencies are installed.
- The source image reference is `/mnt/f/desktop/youtube/뉴런데브/뉴런로보.png`.

## Steps
1. Run `npm test`.
2. Run `npm run build`.
3. Run `node dist/src/cli/main.js --mock "create a file named tmp/ascii-logo-check.txt with text ok"`.
4. Confirm stderr starts with the robot plus uppercase `NDX` ASCII logo before `[socket] connected`.
5. After merge to `main`, rebuild compose with `NDX_GIT_REF=main` and confirm `docker compose logs` shows `git_ref=main`.

## Expected Results
- Unit tests pass.
- `printWelcomeLogo` emits the complete ASCII logo.
- The CLI startup output begins with the ASCII logo, then session initialization output.
- Main-based Docker image logs report `git_ref=main`.

## Logs To Capture
- `npm test` TAP summary.
- CLI startup stderr containing the logo and `[socket] connected`.
- PR and merge result.
- Main-based compose startup provenance.

## Locator Contract
No browser UI exists for this package. Browser locator contracts are not applicable.
