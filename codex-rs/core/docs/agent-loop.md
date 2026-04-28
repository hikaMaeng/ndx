# Agent loop internals

이 문서는 `codex-rs/core`의 실제 Rust 코드 기준으로 에이전트 루프와 주변 시스템을 정리한다.

## 진입점

`Codex::spawn`은 `tx_sub/rx_sub` 제출 채널과 `tx_event/rx_event` 이벤트 채널을 만들고 `submission_loop`를 Tokio task로 띄운다.

`submission_loop`는 `rx_sub.recv().await`를 반복한다. 탈출 조건은 `Op::Shutdown` 처리 함수가 `true`를 반환하는 경우다. 채널이 닫히면 `while let Ok(sub)`도 끝난다.

사용자 입력 계열 `Op::UserInput`, `Op::UserTurn`, `Op::UserInputWithTurnContext`는 `user_input_or_turn_inner`로 간다. 여기서 새 `TurnContext`를 만들고, 이미 실행 중인 regular turn이 있으면 `steer_input`으로 pending input에 넣는다. active turn이 없으면 `spawn_task(..., RegularTask::new())`로 새 turn을 시작한다.

## task 구조

`SessionTask`는 `kind`, `span_name`, `run`, `abort`만 가진다. `RegularTask`, `CompactTask`, `ReviewTask`, `UndoTask`, `UserShellCommandTask`가 이 계약을 따른다.

`Session::start_task`는 다음을 원자적으로 준비한다.

- turn 시작 시각과 token baseline 기록
- `CancellationToken` 생성
- `Notify` 생성
- queued next-turn input과 mailbox trigger input을 `TurnState.pending_input`으로 이동
- `ActiveTurn.tasks`에 `RunningTask` 등록
- 실제 task를 `tokio::spawn`으로 실행

task 완료 시 spawned closure가 rollout을 flush하고, 취소되지 않았다면 `on_task_finished`가 `TurnComplete`를 emit한다.

## regular loop

`RegularTask::run`이 기본 에이전트 루프다.

알고리즘:

1. `TurnStarted` 이벤트를 emit한다.
2. startup prewarm model session이 있으면 가져온다.
3. `next_input = initial input`.
4. `run_turn(sess, ctx, next_input, ...)`를 호출한다.
5. 호출 뒤 `sess.has_pending_input()`이 false면 마지막 assistant message를 반환하고 종료한다.
6. pending input이 남아 있으면 `next_input = []`로 바꾸고 4번으로 돌아간다.

따라서 regular loop가 계속 도는 이유는 active turn 중 들어온 user steer 또는 mailbox mail이 `TurnState.pending_input`에 남아 있기 때문이다.

## sampling loop

`run_turn` 내부 loop는 모델 샘플링 요청 단위다.

각 반복에서:

1. session-start hook을 확인한다.
2. 허용된 pending input을 history에 기록한다.
3. `ContextManager::for_prompt`로 prompt input을 만든다.
4. `run_sampling_request`를 호출한다.
5. 결과의 `model_needs_follow_up`과 `sess.has_pending_input()`을 합쳐 `needs_follow_up`을 계산한다.
6. token limit에 도달했고 follow-up이 필요하면 auto-compact 후 계속한다.
7. follow-up이 없으면 stop hook과 after-agent hook을 실행한다.
8. hook이 continuation prompt를 기록하면 계속한다.
9. hook이 stop하거나 abort하지 않으면 break한다.

`model_needs_follow_up`은 주로 도구 호출, missing call id guardrail, `response.completed.end_turn == false`에서 true가 된다.

## 모델 도구호출 의존 범위

모델은 도구를 "쓸지"와 도구 인자를 구조화해 출력한다. Rust는 그 구조를 그대로 믿지 않고 다음 단계로 제한한다.

- `ToolRouter::build_tool_call`이 `ResponseItem`을 `ToolCall`로 변환한다.
- MCP tool name은 session의 MCP tool metadata로 canonicalize된다.
- local shell call은 `ShellToolCallParams`로 정규화된다.
- unsupported tool은 model-visible 실패 output으로 되돌린다.
- `ToolRegistry::dispatch_any`가 registered handler만 실행한다.
- mutating handler는 `tool_call_gate` 준비를 기다린다.
- pre/post/legacy after-tool hook이 실행을 차단하거나 output을 바꿀 수 있다.

즉, task lifecycle과 종료 조건은 Rust 구조체가 결정한다. 모델은 structured response item을 통해 다음 샘플링이 필요한지를 유발한다.

## 비동기 대기 원리

대기는 목적별 primitive를 쓴다.

- task 완료: `RunningTask.done: Notify`, Tokio task handle, cancellation token.
- interrupt/abort: `CancellationToken` 전파와 pending map clear.
- approval/user-input/dynamic-tool: `TurnState`의 `oneshot::Sender` map에 sender를 넣고 response op가 sender를 깨운다.
- mailbox wait: `Mailbox`가 unbounded mpsc에 mail을 넣고 `watch::Sender<u64>` sequence를 증가시킨다.
- `wait_agent`: 현재 v2 구현은 mailbox sequence watch receiver를 구독하고, pending mail이 없으면 deadline까지 `changed()`를 기다린다.
- agent status: emitted event를 `agent_status_from_event`로 `watch::Sender<AgentStatus>`에 반영한다.

## 탈출 조건

Submission loop:

- `Op::Shutdown` 처리 결과가 `true`
- submission channel close

Task:

- `SessionTask::run` 반환
- `abort_all_tasks` 또는 `abort_turn_if_active`가 cancellation token을 cancel
- task handle drop

`run_turn`:

- 입력이 비었고 pending input도 없으면 즉시 `None`
- session-start hook이 stop
- user-prompt hook이 stop
- sampling stream error 또는 unrecoverable error
- `CodexErr::TurnAborted`
- invalid image 복구 실패
- `needs_follow_up == false`이고 stop/after-agent hook이 계속을 요구하지 않음

Sampling request:

- `ResponseEvent::Completed` 수신
- cancellation
- stream close before completed
- non-retryable error
- retry budget exhausted
- context window exceeded / usage limit reached

## 계속 도는 대표 원인

- 모델이 도구 호출을 계속 emit한다.
- 모델이 `end_turn == false`를 계속 반환한다.
- stop hook이 continuation prompt를 계속 삽입한다.
- pending input이나 mailbox mail이 반복적으로 들어온다.
- token limit 도달 시 auto-compact가 성공하고 follow-up이 남아 계속된다.
- stream retryable error가 retry budget 내에서 반복된다.

무한 루프를 직접 세는 counter는 regular/sampling loop에 없다. token-limit path는 compaction으로 토큰을 낮춘다는 전제에 기대며, stream path는 provider retry budget으로 제한된다.

## 컨텍스트 관리 개입 시점

`run_turn` 시작부에서 pre-sampling compaction이 먼저 실행된다. 그 뒤 `record_context_updates_and_set_reference_context_item`이 full context 또는 settings diff를 history에 기록하고 reference baseline을 갱신한다.

각 sampling 직전에는 `clone_history().for_prompt(...)`가 history를 normalize한다. 여기서 orphan tool output 제거, missing call output 보정, unsupported image 제거가 적용된다.

모델 response item과 tool output은 완료 즉시 `record_completed_response_item` 또는 `record_conversation_items`로 history와 rollout에 들어간다.

모델 응답 뒤 total token usage가 auto-compact limit 이상이고 follow-up이 필요하면 mid-turn compaction이 실행된다. compaction은 history를 summary replacement로 바꾸고, 필요하면 initial context를 재삽입한다.

`ContextManager`는 token usage info와 estimated token count도 제공한다. API usage가 있으면 server token usage를 사용하고, local item은 byte/token heuristic으로 보강한다.

## 프롬프트 삽입과 marker 인식

`<system-remainder>`라는 이름의 parser나 injection path는 `codex-rs`에서 발견되지 않는다.

대신 `ContextualUserFragment`가 marker 기반 prompt fragment를 정의한다. 등록된 fragment는 start/end marker로 injected context 여부를 판별한다. 예시는 다음과 같다.

- `<environment_context>...</environment_context>`
- `<skill>...</skill>`
- `<turn_aborted>...</turn_aborted>`
- `<subagent_notification>...</subagent_notification>`
- `<model_switch>...</model_switch>`
- `<permissions instructions>...</permissions instructions>`
- `# AGENTS.md instructions ... <INSTRUCTIONS>...`

초기 context는 developer message와 contextual user message로 나뉘어 기록된다. 후속 turn은 `TurnContextItem` baseline과 비교해 settings diff만 기록한다. baseline이 없으면 full context를 다시 주입한다.

## hook 삽입점과 영향

Hook runtime은 `src/hook_runtime.rs`와 `src/tools/registry.rs`, `src/session/turn.rs`에 걸쳐 있다.

- `SessionStart`: `run_turn` 시작부와 sampling loop 반복 초기에 실행된다. `should_stop`이면 turn 진행을 멈추고 additional context만 기록할 수 있다.
- `UserPromptSubmit`: 최초 user input과 pending user input 검사 시 실행된다. stop이면 input을 block하고 additional context를 기록한다.
- `PreToolUse`: tool handler 실행 전 실행된다. block이면 실제 도구를 실행하지 않고 block reason을 tool output으로 모델에 돌려준다.
- `PermissionRequest`: request-permissions 계열 승인 결정을 hook이 제공할 수 있다.
- `PostToolUse`: 성공한 tool output 뒤 실행된다. additional context를 기록하고 feedback/stop reason으로 tool output을 대체할 수 있다.
- legacy `AfterToolUse`: post-tool 이후 실행되며 abort 가능하다.
- `Stop`: follow-up이 없을 때 최종 완료 직전에 실행된다. block이면 hook prompt message를 history에 넣고 sampling loop를 계속한다. stop이면 turn을 종료한다.
- `AfterAgent`: stop hook 이후 최종 완료 직전에 실행된다. `FailedAbort`는 turn completion을 error로 중단한다.

Hook additional context는 `HookAdditionalContext` fragment로 conversation history에 들어가 다음 모델 요청에 영향을 준다.

## 서브에이전트 주변 요소

`AgentControl`은 root session tree 범위의 subagent registry와 thread manager weak handle을 가진다. `spawn_agent`는 새 thread를 만들고 initial op를 submit한다.

`Mailbox`는 inter-agent communication을 mpsc queue에 넣고 watch sequence를 증가시킨다. `Session::get_pending_input`은 mailbox delivery phase가 current-turn일 때 mailbox mail을 response input으로 변환해 현재 sampling loop에 합친다.

완료 상태는 event 기반이다. `TurnStarted`, `TurnComplete`, `TurnAborted`, `Error`, `ShutdownComplete`가 `AgentStatus`로 변환되고 watch sender에 반영된다.

