# Turbo monorepo refactor

- suite: monorepo-refactor
- runned: 2026-05-06T17:16:38.629Z
- dependencies: ndx 0.1.35, node >=22, yarn >=4.14.1

## Results

### workspace

- PASS root-workspace-contract: Root workspace uses Turbo and Yarn PnP
  - PASS inspect-root-manifests: Root manifests implement the Turbo monorepo contract.
    - evidence: package.json has private true and workspaces ["apps/*","packages/*"].
    - evidence: .yarnrc.yml contains nodeLinker: pnp.
    - evidence: turbo.json defines build/test tasks and tsconfig.json references packages/ndx, apps/ndx, and apps/ndxserver.
  - PASS install-and-build: Immutable install and Turbo build completed successfully.
    - evidence: yarn install --immutable exited 0.
    - evidence: yarn build exited 0 with 4 successful Turbo tasks.
    - evidence: .gitignore excludes node_modules and no workspace node_modules tree was created.

### packages

- PASS domain-package-contract: Domain package owns ndx logic
  - PASS inspect-package-layout: The core package owns the required domain folders.
    - evidence: packages/ndx/package.json name is @neurondev/ndx-core.
    - evidence: find packages/ndx/src -maxdepth 2 includes cli, server, dashboard, config, model, agent, runtime, process, tools, and shared.
  - PASS inspect-exports: The core package exposes the planned subpaths from dist.
    - evidence: packages/ndx/package.json exports ., ./cli, ./server, ./dashboard, ./shared, and ./package.json.
    - evidence: yarn build produced dist entrypoints for those exports.
- PASS dependency-direction-contract: Dependencies remain app-to-package and acyclic
  - PASS check-app-imports: packages/ndx does not import app code and apps depend on the core package.
    - evidence: rg "apps/|../../apps|from ['\"].*apps" packages/ndx/src returned no matches.
    - evidence: apps/ndx/package.json depends on @neurondev/ndx-core: workspace:^.
    - evidence: apps/ndxserver/package.json depends on @neurondev/ndx-core: workspace:^.
  - PASS check-internal-cycle: The old runtime-agent-session cycle is broken by runner injection and top-level tools.
    - evidence: packages/ndx/src/runtime/runtime.ts defines RuntimeAgentRunner and has no import from ../agent.
    - evidence: packages/ndx/src/session/server.ts imports runAgent and passes runAgent into new AgentRuntime.
    - evidence: packages/ndx/src/agent/loop.ts imports ../tools/registry.js, ../tools/process-runner.js, and ../tools/schema.js, not session tools.
    - evidence: rg over runtime/agent/tools for agent-loop/session-server cycle only found tools/external/runner.ts importing ../../session/sandbox-paths.js for path mapping.

### apps

- PASS app-wrapper-contract: Apps are thin wrappers and preserve bins
  - PASS inspect-apps: App sources are bin loaders only.
    - evidence: apps/ndx/src/bin/ndx.ts imports loadCoreCli and calls main().
    - evidence: apps/ndx/src/bin/ndxserver.ts and apps/ndxserver/src/bin/ndxserver.ts set NDX_INVOKED_AS_SERVER and call core main().
    - evidence: rg over app sources found no config loading, SessionServer construction, dashboard rendering, or Docker sandbox implementation.
  - PASS run-bins: Built app bins print the expected version.
    - evidence: yarn build exited 0.
    - evidence: node apps/ndx/dist/bin/ndx.js --version printed 0.1.35.
    - evidence: node apps/ndx/dist/bin/ndxserver.js --version printed 0.1.35.
    - evidence: node apps/ndxserver/dist/bin/ndxserver.js --version printed 0.1.35.
  - PASS pack-contract: The Yarn 4 pack dry-run includes compiled bin files and package docs.
    - evidence: yarn workspace @neurondev/ndx pack --dry-run exited 0.
    - evidence: Dry-run output included dist/bin/ndx.js and dist/bin/ndxserver.js.
    - evidence: Packed package.json rewrites @neurondev/ndx-core dependency to ^0.1.35.
    - evidence: Temporary prefix install from /tmp/ndx-core.tgz and /tmp/ndx-app.tgz ran /tmp/ndx-global/bin/ndx --version and /tmp/ndx-global/bin/ndxserver --version, both printing 0.1.35.
- PASS toolcontainer-contract: Toolcontainer owns sandbox image
  - PASS inspect-compose: Compose builds the sandbox from apps/toolcontainer and the Dockerfile keeps the original runtime contract.
    - evidence: docker-compose.yml ndx-sandbox build.context is apps/toolcontainer.
    - evidence: apps/toolcontainer/Dockerfile starts FROM node:22-bookworm-slim.
    - evidence: Dockerfile installs bash, git, jq, patch, python3, ripgrep, wget, xz-utils, Playwright Chromium, and /usr/local/bin/apply_patch.
    - evidence: npm run deploy built hika00/ndx-sandbox:0.1.1 and verified the sandbox write.

### documentation

- PASS docs-describe-monorepo: Docs describe the monorepo contract
  - PASS inspect-root-docs: Root docs describe the new monorepo and verification contract.
    - evidence: README.md describes apps/ndx, apps/ndxserver, apps/toolcontainer, packages/ndx, install bins, and npm run deploy.
    - evidence: docs/architecture.md documents workspace layout and dependency direction.
    - evidence: docs/testing.md documents Turbo build, agenttest policy, deploy, and monorepo package-boundary coverage.
  - PASS inspect-package-docs: The core package has the required README and docs set.
    - evidence: packages/ndx/README.md exists with a nav table.
    - evidence: packages/ndx/docs contains overview.md, architecture.md, api.md, usage.md, constraints.md, internals.md, and testing.md.
    - evidence: App package README/docs were also added under apps/ndx, apps/ndxserver, and apps/toolcontainer.

### deploy

- PASS deploy-contract: Deploy verifies build and sandbox
  - PASS run-deploy: The full deploy command completed the build, policy hook, compose refresh, sandbox write, and teardown.
    - evidence: npm run deploy exited 0.
    - evidence: Deploy output included turbo 2.9.9 with 4 successful build tasks.
    - evidence: Deploy output included agenttest policy hook: strict JSON results under test/YYYYMMDD.
    - evidence: Deploy output built docker.io/hika00/ndx-sandbox:0.1.1 from apps/toolcontainer.
    - evidence: Deploy output created, started, stopped, removed ndx-ndx-sandbox-1, then removed ndx_default network.

