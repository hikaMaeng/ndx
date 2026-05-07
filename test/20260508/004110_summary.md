# Agent loop modularization preserves behavior and documents Codex parity

- suite: agent-loop-refactor
- runned: 2026-05-07T15:59:50.566Z
- dependencies: ndx 0.1.39, typescript 5.9.2, node >=22

## Results

### structure

- PASS loop-entrypoint-preserved: Public runAgent entrypoint remains stable
  - PASS inspect-loop-entrypoint: The entrypoint exports runAgent and re-exports AgentEvent/AgentRunOptions while importing state and sampling from loop submodules.
    - evidence: packages/ndx/src/agent/loop.ts imports ./loop/state.js, ./loop/sampling.js, and ./loop/types.js.
    - evidence: packages/ndx/src/agent/loop.ts contains export async function runAgent(options: AgentRunOptions): Promise<string>.
  - PASS inspect-submodules: The loop folder contains focused TypeScript modules for types, state, skills, sampling, and tool execution.
    - evidence: find packages/ndx/src/agent/loop -maxdepth 1 -type f listed sampling.ts, skills.ts, state.ts, tool-execution.ts, and types.ts.
    - evidence: Agent events are separated in packages/ndx/src/agent/loop/types.ts.

### behavior

- PASS build-preserves-types: TypeScript build preserves agent loop contracts
  - PASS run-package-build: The repository TypeScript build completed successfully after yarn install --immutable prepared PnP state.
    - evidence: yarn install --immutable exited 0.
    - evidence: yarn build exited 0.
    - evidence: Turbo reported 4 successful tasks: @neurondev/ndx, @neurondev/ndx-core, @neurondev/ndx-toolcontainer, and @neurondev/ndxserver-app.

### documentation

- PASS codex-parity-analysis-documented: OpenAI Codex loop comparison is documented
  - PASS inspect-architecture-doc: Architecture and internals docs now describe the module split and Codex Rust parity matrix.
    - evidence: packages/ndx/docs/architecture.md contains an Agent Loop section listing types.ts, state.ts, skills.ts, sampling.ts, and tool-execution.ts.
    - evidence: packages/ndx/docs/internals.md contains an Agent Loop Parity table mapping Codex Rust responsibilities to NDX owners.
    - evidence: packages/ndx/docs/testing.md references test/20260508/004110_agent-loop-refactor.json.

### deployment

- PASS deploy-contract: Deploy verification completes
  - PASS run-deploy: The deploy script completed build, Docker image build, compose start, and cleanup.
    - evidence: npm run deploy exited 0.
    - evidence: Deploy output included: Tasks: 4 successful, 4 total.
    - evidence: Deploy output included: Image hika00/ndx-sandbox:0.1.1 Built.
    - evidence: Deploy output included container start, stop, remove, and network removal for ndx-deploy-9468.

