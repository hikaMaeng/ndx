# Publish ndx 0.1.40 and install-test with a Tetris acceptance task

- suite: publish-install-tetris-0.1.40
- runned: 2026-05-08T14:35:38.286Z
- dependencies: ndx 0.1.40, registry https://verdaccio.neurondev.net/

## Results

### versioning

- PASS version-bump: Workspace packages use the new publish version
  - PASS inspect-manifests: All release-bearing workspace package manifests report 0.1.40.
    - evidence: node manifest check output: package.json 0.1.40; apps/ndx/package.json 0.1.40; packages/ndx/package.json 0.1.40; apps/ndxserver/package.json 0.1.40; apps/toolcontainer/package.json 0.1.40.
    - evidence: yarn install --immutable exited 0 after the version changes.
    - evidence: yarn build exited 0 across @neurondev/ndx, @neurondev/ndx-core, @neurondev/ndx-toolcontainer, and @neurondev/ndxserver-app.

### publish

- FAIL verdaccio-publish: New packages are published to Verdaccio
  - FAIL publish-core: The core package tarball was prepared, but Verdaccio TLS connections reset during publish.
    - evidence: Windows Node npm publish for @neurondev/ndx-core@0.1.40 reached 'Publishing to https://verdaccio.neurondev.net/' then failed with ECONNRESET.
    - evidence: npm ping https://verdaccio.neurondev.net/ also failed with ECONNRESET against /-/ping.
  - FAIL publish-cli: The CLI package was staged and the workspace dependency issue was fixed, but Verdaccio publish failed with the same TLS reset.
    - evidence: npm pack from apps/ndx now shows @neurondev/ndx-core dependency as ^0.1.40 instead of workspace:^.
    - evidence: A bundled local staging tarball was also prepared and validated, but publish to @neurondev/ndx@0.1.40 failed with ECONNRESET.
  - FAIL query-registry: The registry did not expose the requested 0.1.40 versions during this run.
    - evidence: npm view @neurondev/ndx@0.1.40 returned E404.
    - evidence: npm view @neurondev/ndx-core@0.1.40 failed with ECONNRESET.

### acceptance

- FAIL sandbox-install-tetris: Installed ndx can drive a Tetris creation task in an isolated sandbox
  - FAIL create-sandbox: Verdaccio install could not run because @neurondev/ndx@0.1.40 was not published; the equivalent local tarball install passed.
    - evidence: npm install -g @neurondev/ndx@0.1.40 from Verdaccio returned ETARGET.
    - evidence: Local tarball install into /tmp/ndx-local-acceptance-0.1.40/prefix exited 0.
    - evidence: /tmp/ndx-local-acceptance-0.1.40/prefix/bin/ndx --version returned 0.1.40.
    - evidence: /tmp/ndx-local-acceptance-0.1.40/prefix/bin/ndxserver --version returned 0.1.40.
  - PASS create-tetris: The isolated sandbox contains a Tetris project with the required files and gameplay hooks.
    - evidence: Created /tmp/ndx-local-acceptance-0.1.40/work/tetris/index.html.
    - evidence: Created /tmp/ndx-local-acceptance-0.1.40/work/tetris/styles.css.
    - evidence: Created /tmp/ndx-local-acceptance-0.1.40/work/tetris/game.js.
  - PASS verify-tetris: Automated file checks passed for the generated Tetris project.
    - evidence: Node verification returned result true for semantic main, next-piece UI, board dimensions, movement, rotation, line clearing, and game loop.

### documentation

- PASS publish-docs: Publish and install-test documentation records the 0.1.40 acceptance
  - PASS update-docs: Root and package docs record the release acceptance suite path and sandbox install contract.
    - evidence: docs/testing.md references test/20260508/214231_publish-install-tetris.json.
    - evidence: docs/usage.md records the clean sandbox prefix acceptance contract.
    - evidence: apps/ndx/docs/testing.md records release install acceptance for the install-facing CLI package.
    - evidence: packages/ndx/docs/testing.md references the 0.1.40 release suite.

### deployment

- FAIL deploy-and-commit: Deploy verification and Git commit complete the release task
  - PASS run-deploy: Deploy completed successfully after the version and dependency changes.
    - evidence: npm run deploy exited 0.
    - evidence: Turbo build completed for all four packages.
    - evidence: Docker image hika00/ndx-sandbox:0.1.1 built and compose container ndx-deploy-51389-ndx-sandbox-1 started, stopped, removed, and its network removed.
  - FAIL commit: A final commit is intentionally deferred until the failed strict JSON report is finalized and can be included.
    - evidence: The publish task is blocked by Verdaccio ECONNRESET and the report is being finalized with failures before committing the recorded state.

