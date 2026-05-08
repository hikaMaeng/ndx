# Agent loop subsystem parity and artifact context

- suite: agent-loop-subsystems
- runned: 2026-05-08T11:53:01.311Z
- dependencies: ndx 0.1.39, node >=22, yarn >=4.14.1

## Results

### tools

- PASS builtin-tool-registration: Built-in tool registry exposes context and input tools
  - PASS inspect-registry: The task layer registers request_user_input and the MCP resource tools.
    - evidence: packages/ndx/src/tools/registry.ts imports requestUserInputTool and mcpResourceTools and adds them in taskTools().
    - evidence: packages/ndx/src/tools/mcp/resources.ts defines list_mcp_resources, list_mcp_resource_templates, and read_mcp_resource.
    - evidence: Built registry smoke printed request_user_input, list_mcp_resources, list_mcp_resource_templates, read_mcp_resource, and spawn_agent.
  - PASS build-types: The package TypeScript build completed.
    - evidence: Command completed with exit code 0: yarn workspace @neurondev/ndx-core build

### subagents

- PASS subagent-tools-use-controller: Collaboration tools use a TypeScript sub-agent controller
  - PASS inspect-controller: Collaboration tools dispatch to ToolContext.agentController and runtime passes a shared controller into runAgent.
    - evidence: packages/ndx/src/tools/collaboration/agents.ts dispatches spawn_agent, send_input, resume_agent, wait_agent, close_agent, and list_agents to context.agentController.
    - evidence: packages/ndx/src/tools/collaboration/agent-jobs.ts dispatches spawn_agents_on_csv and report_agent_job_result to context.agentController.
    - evidence: packages/ndx/src/runtime/runtime.ts creates a sub-agent controller and passes agentController into the injected runAgent call.
    - evidence: packages/ndx/src/agent/subagents.ts implements createSubAgentController.
  - PASS run-subagent-smoke: The smoke script spawned, waited, listed, and closed a mock child agent.
    - evidence: Smoke output: spawnStatus=running, waitStatus=completed, finalText=mock agent completed, listedCount=1, closeStatus=closed.
    - evidence: The smoke script imported packages/ndx/dist/agent/subagents.js and used MockModelClient plus runAgent.

### artifacts

- PASS artifact-context-contract: Artifact classification is documented and reflected in loop context
  - PASS inspect-rust-analysis-doc: The new artifact document records the Rust resource boundary and NDX contract.
    - evidence: packages/ndx/docs/agent-artifact-context.md cites codex-rs/protocol/src/user_input.rs, codex-rs/protocol/src/models.rs, codex-rs/core/src/context/fragment.rs, app-server-protocol/src/protocol/thread_history.rs, and MCP resource read paths.
    - evidence: packages/ndx/docs/agent-artifact-context.md states that UI thread artifacts are not a blanket future prompt inclusion rule.
  - PASS inspect-loop-code: The loop adds bounded referenced artifact context for existing local files under cwd.
    - evidence: packages/ndx/src/agent/loop/artifacts.ts limits artifacts to existing files under cwd and caps the list at 8 with 1200-character text excerpts.
    - evidence: packages/ndx/src/agent/loop/state.ts inserts artifactContextMessages before skill messages and the user prompt.
    - evidence: Artifact smoke emitted a # Referenced Artifacts message for packages/ndx/docs/agent-artifact-context.md with path, size, modified_at, and excerpt.

### documentation

- PASS docs-updated: Package docs record new loop subsystem contracts
  - PASS inspect-docs: Package documentation records the new agent loop subsystem contracts.
    - evidence: packages/ndx/README.md links docs/agent-artifact-context.md.
    - evidence: packages/ndx/docs/architecture.md lists artifacts.ts and subagents.ts.
    - evidence: packages/ndx/docs/internals.md records explicit resource/artifact context and sub-agent control plane ownership.
    - evidence: packages/ndx/docs/api.md documents built-in MCP resource tools, collaboration controller behavior, and Referenced Artifacts context.
    - evidence: packages/ndx/docs/testing.md references test/20260508/201728_agent-loop-subsystems.json.

### deployment

- PASS deploy-contract: Repository deploy contract still passes
  - PASS run-deploy: The deploy script completed successfully.
    - evidence: Command completed with exit code 0: npm run deploy.
    - evidence: Deploy output ran Turbo build for @neurondev/ndx, @neurondev/ndx-core, @neurondev/ndx-toolcontainer, and @neurondev/ndxserver-app.
    - evidence: Deploy output ran the agenttest policy hook: agenttest policy: strict JSON results under test/YYYYMMDD.
    - evidence: Deploy output built hika00/ndx-sandbox:0.1.1, created and started ndx-deploy-40288-ndx-sandbox-1, then stopped and removed the container and network.

