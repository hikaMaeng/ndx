# Remove monorepo transition leftovers

- suite: monorepo-cleanup-20260507
- runned: 2026-05-07T04:00:35.521Z
- dependencies: ndx 0.1.39, turbo 2.9.9

## Results

### workspace

- PASS remove-generated-root-artifacts: Root generated artifacts are absent
  - PASS inspect-generated-paths: Generated root artifacts and runtime volume contents were absent after cleanup.
    - evidence: Command: for p in dist .turbo .yarn/install-state.gz .yarn/unplugged; do test ! -e "$p" && echo "absent $p"; done
    - evidence: Observed: absent dist, absent .turbo, absent .yarn/install-state.gz, absent .yarn/unplugged.
    - evidence: Command: find docker/volume -mindepth 2 -type f -o -type d | sort
    - evidence: Observed: only docker/volume/home-ndx/.gitkeep and docker/volume/workspace/.gitkeep.
  - PASS inspect-required-runtime-placeholders: Both Docker volume placeholders remain tracked.
    - evidence: Command: git ls-files docker/volume/home-ndx/.gitkeep docker/volume/workspace/.gitkeep
    - evidence: Observed: docker/volume/home-ndx/.gitkeep and docker/volume/workspace/.gitkeep.
- PASS remove-empty-root-src: Legacy root src is absent
  - PASS inspect-root-src: The legacy root src path is absent.
    - evidence: Command: test -e src && echo exists src || echo absent src
    - evidence: Observed output: absent src.
  - PASS inspect-monorepo-source: All expected workspace source roots exist.
    - evidence: Command: for p in apps/ndx/src apps/ndxserver/src packages/ndx/src; do test -e "$p" && echo "exists $p"; done
    - evidence: Observed: exists apps/ndx/src, exists apps/ndxserver/src, exists packages/ndx/src.

### tracked-tests

- PASS remove-legacy-tests-tree: Legacy tests directory is removed
  - PASS inspect-tracked-tests: No Git-tracked files remain under tests.
    - evidence: Command: git ls-files tests | wc -l
    - evidence: Observed output: 0.
  - PASS inspect-agenttest-policy-files: The active test directory contains both previous monorepo evidence and the cleanup suite.
    - evidence: Command: find test/20260507 -maxdepth 1 -type f -printf '%f\n' | sort
    - evidence: Observed: 011454_monorepo-refactor.json, 011454_report.json, 011454_summary.md, 124110_monorepo-cleanup.json.

### documentation

- PASS document-cleanup-policy: Cleanup policy is documented
  - PASS inspect-testing-doc: Testing docs now record the test/ policy and generated artifact boundaries.
    - evidence: docs/testing.md contains: Use test/YYYYMMDD/HHMMSS_*.json for suites.
    - evidence: docs/testing.md contains: Do not create or restore root tests/, tests/plans, or tests/reports.
    - evidence: docs/testing.md documents root dist, .turbo, .yarn/unplugged, .yarn/install-state.gz, and Docker volume cleanup boundaries.
  - PASS inspect-internals-doc: Internals docs now distinguish workspace source roots from stale root paths.
    - evidence: docs/internals.md states root src, root dist, and root tests are not source-owned monorepo paths.
    - evidence: docs/internals.md states source belongs under apps/*/src or packages/ndx/src.
    - evidence: docs/usage.md path-mapping example now uses test/20260507 instead of tests/reports.

### verification

- PASS build-after-cleanup: Workspace builds after cleanup
  - PASS run-install-build: Install and Turbo build succeeded after cleanup.
    - evidence: Command: yarn install --immutable && yarn build
    - evidence: Yarn 4.14.1 completed with only the known PnP ESM loader warning.
    - evidence: Turbo 2.9.9 reported Tasks: 4 successful, 4 total for @neurondev/ndx, @neurondev/ndx-core, @neurondev/ndx-toolcontainer, and @neurondev/ndxserver-app.
  - PASS run-bin-smoke: Compiled app wrapper bins reported the expected version.
    - evidence: Command: node apps/ndx/dist/bin/ndx.js --version
    - evidence: Command: node apps/ndx/dist/bin/ndxserver.js --version
    - evidence: Command: node apps/ndxserver/dist/bin/ndxserver.js --version
    - evidence: Observed output: 0.1.39 for all three commands.

