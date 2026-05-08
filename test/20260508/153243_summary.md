# Agent loop emits Codex-style item lifecycle stream events

- suite: agent-loop-stream-events
- runned: 2026-05-08T07:09:42.021Z
- dependencies: ndx 0.1.39, typescript 5.9.2, node >=22

## Results

### behavior

- PASS stream-deltas-before-final: Assistant deltas are emitted before final text
  - PASS inspect-stream-types: ModelClient now exposes optional stream events and AgentEvent includes item lifecycle, assistant delta, and tool-call delta variants.
    - evidence: packages/ndx/src/shared/types.ts defines ModelStreamEvent and optional ModelClient.stream.
    - evidence: packages/ndx/src/agent/loop/types.ts defines item_started, agent_message_delta, tool_call_delta, and item_completed AgentEvent variants.
    - evidence: packages/ndx/src/agent/loop/sampling.ts consumes ModelStreamEvent before final ModelResponse handling.
  - PASS inspect-runtime-forwarding: AgentRuntime forwards streaming progress as protocol events and keeps persisted assistant history tied to final model_text.
    - evidence: packages/ndx/src/runtime/runtime.ts forwards item_started, agent_message_delta, tool_call_delta, and item_completed before model_text handling.
    - evidence: packages/ndx/src/shared/protocol.ts defines matching runtime event message variants.
    - evidence: packages/ndx/src/session/server/notifications.ts maps streaming progress to item/* notification methods.
- PASS tool-followup-preserved: Tool call follow-up behavior is preserved
  - PASS run-build: The workspace build completed after stream events and initial context injection were added.
    - evidence: yarn build exited 0.
    - evidence: Turbo reported 4 successful tasks.
    - evidence: TypeScript accepted ModelClient.stream, runtime protocol events, provider adapters, and initial-context input construction.

### documentation

- PASS streaming-contract-documented: Streaming event contract is documented
  - PASS inspect-docs: Docs now describe streaming runtime events, initial turn context snapshots, final text compatibility, and the verification suite.
    - evidence: packages/ndx/docs/api.md documents item_started, agent_message_delta, tool_call_delta, item_completed, and Turn Context Input.
    - evidence: packages/ndx/docs/internals.md maps Codex Rust turn/context files to NDX initial-context, sampling, runtime, and provider owners.
    - evidence: packages/ndx/docs/testing.md references test/20260508/153243_agent-loop-stream-events.json and the initial-context contract.

### deployment

- PASS deploy-contract: Deploy verification completes
  - PASS run-deploy: The deploy script completed build, test policy output, Docker image build, compose start, and cleanup.
    - evidence: npm run deploy exited 0.
    - evidence: Deploy output included: Tasks: 4 successful, 4 total.
    - evidence: Deploy output included: Image hika00/ndx-sandbox:0.1.1 Built.
    - evidence: Deploy output included container start, stop, removal, and network removal for ndx-deploy-24651.

