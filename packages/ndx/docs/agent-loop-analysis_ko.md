# 에이전트 루프 분석

이 리포트는 `codex/agent-loop-refactor` 브랜치에서 확인한 코드 근거
중심의 결론을 기록한다. 커밋 `936da925`에서 제거된 과거 OpenAI Codex
Rust 런타임과 이 패키지의 TypeScript NDX 런타임을 비교한다.

## 근거

`git show 936da925^:<path>`로 확인한 과거 Rust 소스:

| 질문 | Rust 근거 |
| ---- | --------- |
| Regular task와 반복 pending input turn | `codex-rs/core/src/tasks/regular.rs` |
| Sampling loop, response stream 처리, follow-up 판단 | `codex-rs/core/src/session/turn.rs` |
| AGENTS.md instruction 조립 | `codex-rs/core/src/agents_md.rs` |
| `<environment_context>` user fragment | `codex-rs/core/src/context/environment_context.rs` |
| Sub-agent 생성, 상태, parent notification | `codex-rs/core/src/agent/control.rs` |

현재 TypeScript 소스:

| 질문 | NDX 근거 |
| ---- | -------- |
| Public agent loop와 max-turn budget | `src/agent/loop.ts` |
| Turn별 AGENTS.md와 environment context snapshot | `src/agent/loop/initial-context.ts` |
| Conversation state와 final-message persistence | `src/agent/loop/state.ts` |
| Streaming collection과 follow-up 판단 | `src/agent/loop/sampling.ts` |
| Tool execution과 output accumulation | `src/agent/loop/tool-execution.ts` |
| Provider stream event mapping | `src/model/openai-responses.ts`, `src/model/openai.ts`, `src/model/router.ts` |
| Runtime 및 JSON-RPC progress event | `src/runtime/runtime.ts`, `src/shared/protocol.ts`, `src/session/server/notifications.ts` |
| Collaboration 및 agent-job tool availability | `src/tools/collaboration/agents.ts`, `src/tools/collaboration/agent-jobs.ts`, `src/tools/registry.ts` |

## 응답 스트림

Rust는 하나의 sampling request 안에서 여러 response item을 받을 수 있다.
turn 주석은 한 sampling request가 function call 요청이나 assistant message를
반환할 수 있고, 여러 item도 포함할 수 있다고 설명한다. session loop는
완료된 response item을 기록하고, 결과가 follow-up을 계속 요구할 때만
다시 sampling한다.

NDX도 progress와 final state를 분리한다.

- `ModelClient.stream`은 optional이며 `ModelStreamEvent`를 반환한다.
- `OpenAiResponsesAdapter.stream`은 Responses API에 `stream: true`를 요청한다.
- `mapResponsesStreamEvent`는 `response.output_item.added`,
  `response.output_text.delta`, `response.function_call_arguments.delta`,
  `response.output_item.done`, `response.completed`를 매핑한다.
- `collectStreamingResponse`는 `item_started`, `agent_message_delta`,
  `tool_call_delta`, `item_completed`를 즉시 전달하지만,
  `response_completed` 이후에만 `ModelResponse`를 반환한다.
- `updateStateFromModelResponse`는 최종 response가 확정된 뒤에만 assistant
  text를 저장한다. delta는 final history로 저장하지 않는다.

결론: 하나의 model request 안에서 중간 text와 tool-call argument fragment를
emit할 수 있지만, branch state는 completed response item을 기준으로 전진한다.

## Tool Follow-Up

Rust는 tool execution을 follow-up 경계로 취급한다. sampling 결과가
`model_needs_follow_up`을 설정할 수 있고, outer loop는 이를 pending input과
합쳐 다음 sampling 여부를 결정한다. tool output은 다음 sampling request
전에 model history에 다시 기록된다.

NDX는 더 좁지만 명확한 계약을 가진다.

- `runSamplingRequest`는 완료된 `ModelResponse` 하나를 받는다.
- `modelNeedsFollowUp`은 `response.toolCalls.length > 0`일 때 true다.
- `executeToolCalls`는 모든 tool call을 `Promise.all`로 실행한다.
- 모든 tool call이 resolve된 뒤에만 `tool_result` event를 emit하고
  `function_call_output` item을 반환한다.
- `runSamplingRequest`는 반환된 output item 전체를 `state.input`에 push하고
  `needsFollowUp: true`를 반환한다.

결론: NDX는 첫 tool result가 도착하자마자 다음 model request를 시작하지
않는다. 해당 response의 tool call 전체가 끝날 때까지 기다린 뒤, 누적된
output을 함께 보낸다. Abort signal은 이 대기를 끊을 수 있지만, 그렇지
않으면 멈춘 tool이 follow-up cycle을 막는다.

## Sub-Agent와 Agent Job

Rust에는 실제 sub-agent control plane이 있다. `AgentControl::spawn_agent`는
spawn slot을 예약하고 child thread를 만들며 initial operation을 submit한 뒤,
live thread metadata, mailbox delivery, watch receiver를 통해 상태를 보고한다.
`format_environment_context_subagents`는 열려 있는 child agent를 parent
environment context에 렌더링할 수 있다. 완료 notification은 반드시 새 parent
turn을 trigger하지 않고도 parent에 주입될 수 있다.

현재 NDX TypeScript 패키지는 collaboration schema만 노출하고 backend는
구현하지 않는다.

- `collaborationTools()`는 `spawn_agent`, `send_input`, `resume_agent`,
  `wait_agent`, `close_agent`, `list_agents`를 등록한다.
- `agentJobTools()`는 `spawn_agents_on_csv`, `report_agent_job_result`를
  등록한다.
- 모든 구현은 `unavailable` JSON output을 반환하는 placeholder다.
- 해당 task tool definition의 `supportsParallelToolCalls`는 false다.
- agent loop는 이 tool들도 일반 tool call처럼 취급한다. output은
  `executeToolCalls`로 수집되어 다른 tool result와 동일하게 model에
  되돌아간다.

결론: 이 브랜치에서 sub-agent와 agent-job tool은 NDX 안에서 background work를
만들 수 없다. parent loop를 자체적으로 계속 살려 두지도 못한다. 이들은
unavailable tool output을 반환해 model이 다른 follow-up step을 선택하게 할
수 있을 뿐이다.

## Queue와 Concurrency

Rust는 목적별 queue와 wakeup을 여러 개 쓴다. op submission queue, active
turn의 pending input, inter-agent message용 mailbox delivery, agent state용
status watch receiver, cancellation token, child-agent limit용 spawn slot
reservation이 분리되어 있다.

NDX의 현재 model/tool loop는 단순하다.

- 공개 budget은 `runAgent`의 `config.maxTurns`다.
- 하나의 model response에서 나온 tool call들은 `Promise.all`로 동시에 실행된다.
- tool execution은 `executeToolInWorker`를 통해 child Node worker에 위임된다.
- `src/agent/loop/*` 안에는 loop-local semaphore가 없다.
- collaboration 및 agent-job tool은 현재 background work를 queue에 넣지 않는다.

결론: 활성 NDX loop에는 max-turn guard와 모든 tool call 완료 후 다음 sample을
진행하는 동작이 있지만, Rust의 전체 task, mailbox, status-watch, child-agent
queue topology는 없다.

## 초기 Instructions

Rust는 base instructions와 contextual user fragment를 분리한다. base
instructions는 prompt envelope에 들어가고, AGENTS.md, skills, apps,
permissions, `<environment_context>`는 model-visible contextual message로
삽입된다.

NDX도 이 분리를 따른다.

- Provider adapter는 `withOperationalInstructions(config.instructions)`를
  API-level instructions로 받는다.
- config discovery의 `loadAgentsInstructions`는 AGENTS.md source path를
  `config.contextSources`에 기록한다.
- `buildInitialContext`는 turn construction 시점에 해당 `agents` source를
  읽는다.
- 이 함수는 `# AGENTS.md instructions for <cwd>` 제목과
  `<INSTRUCTIONS>...</INSTRUCTIONS>`를 담은 user message 하나를 만든다.
- 이어서 cwd, shell, current date, timezone, permission mode, global ndx dir,
  project ndx dir를 담은 `<environment_context>` user message를 추가한다.
- `createInitialState`는 이 initial context를 skill message와 user prompt
  앞에 둔다.
- OpenAI Chat은 `developer`와 `system` input message를 chat `system`으로
  되돌려 매핑하고, Responses는 `responsesInput`을 통해 `system`,
  `developer`, `user`, `assistant` message role을 받는다.

결론: base instructions는 provider-level configuration으로 남고, AGENTS.md와
environment fact는 turn별 user context가 된다. AGENTS.md나 실행 환경의 변경은
persisted assistant history를 수정하지 않고도 다음 새 turn input에 반영된다.

## 브랜치 결과

이 브랜치는 streaming item lifecycle event와 initial context injection을
구현한다. 하지만 Rust의 전체 session task graph, sub-agent backend, hook
continuation, compaction machinery를 package loop로 직접 이식하지는 않는다.
그 영역은 session/runtime module이 더 큰 Rust topology를 채택하기 전까지
별도 future work로 남는다.
