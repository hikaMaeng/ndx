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

## live thread/session 구조

에이전트 루프는 독립 함수가 아니라 live thread/session 객체 그래프 위에서 돈다.

`ThreadManager`는 live thread map을 유지한다. `ThreadManagerState.threads`는 `ThreadId -> Arc<CodexThread>`이고, `thread_created_tx` broadcast 채널은 새 thread 생성을 외부 관찰자가 감지하는 경로다. `ThreadManager::spawn_thread_inner`는 `Codex::spawn`으로 core session을 만들고, 첫 이벤트가 `SessionConfigured`인지 확인한 뒤 `CodexThread`를 live map에 넣는다.

`CodexThread`는 `Codex`, `rollout_path`, file-watch registration, out-of-band elicitation count를 가진 live thread handle이다. 외부 진입점은 대부분 이 handle을 지난다.

- `submit` / `submit_with_trace`: `Op`를 submission queue에 넣는다.
- `next_event`: core event queue에서 다음 `Event`를 읽는다.
- `agent_status` / `subscribe_status`: live status snapshot과 watch receiver를 제공한다.
- `inject_response_items` / `inject_user_message_without_turn`: 모델-visible history에 out-of-band item을 넣는다.
- `ensure_rollout_materialized` / `flush_rollout`: durable rollout 경계를 강제한다.

`Session`은 실제 context와 task 상태를 가진다. `Session.state` 안의 `ContextManager`가 모델-visible history를 보유하고, `active_turn`은 현재 turn의 task set, pending input, approval/user-input/dynamic-tool waiters, token baseline을 보유한다. 따라서 “현재 세션에서 일어나는 모든 일”은 단순 prompt 문자열이 아니라 live `Session` history, pending input, active task, mailbox, status watch, rollout writer 상태를 합친 context로 해석해야 한다.

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

## 영속 저장소와 JSONL

Rust core는 live session 상태만 믿지 않는다. 대화와 이벤트는 rollout JSONL과 message history JSONL에 규칙적으로 기록된다.

Rollout persistence는 `codex-rs/rollout/src/recorder.rs`의 `RolloutRecorder`가 담당한다. 새 thread는 `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread_id>.jsonl` 계열 파일을 만들고, 각 line은 `RolloutLine` envelope 안에 `RolloutItem`을 담는다. 주요 item은 다음과 같다.

- `SessionMeta`: thread id, source, base instructions, fork origin, dynamic tools 같은 thread metadata.
- `TurnContext`: turn별 model/cwd/sandbox/approval/personality/context snapshot.
- `ResponseItem`: 모델-visible user/assistant/tool/history item.
- `EventMsg`: `TurnStarted`, `TurnComplete`, `TurnAborted`, tool begin/end, hook, context compaction 등 protocol event.
- `Compacted`: context compaction 결과.

`Session::record_conversation_items`는 in-memory `ContextManager`에 item을 먼저 기록하고, 같은 item을 rollout에 append한 뒤 raw response item event를 emit한다. `Session::send_event`는 `EventMsg`를 rollout에 persist하고 `tx_event`로 live client에게 전달한다. task 완료 closure는 `flush_rollout`을 호출한 뒤 `TurnComplete`를 emit하므로, turn completion 전까지 이전 rollout writes가 durability barrier를 지난다. interrupt path도 `<turn_aborted>` marker를 rollout에 기록하고 flush한 뒤 `TurnAborted`를 emit한다. 이는 외부 client가 abort event를 받고 즉시 rollout을 다시 읽어도 marker를 볼 수 있게 하기 위한 순서다.

별도 전역 prompt history는 `codex-rs/core/src/message_history.rs`가 `~/.codex/history.jsonl`에 저장한다. schema는 `{session_id, ts, text}`이고, `config.history.persistence == SaveAll`일 때만 append한다. Unix에서는 append mode와 owner-only permission을 사용하고, advisory lock으로 concurrent writer interleaving을 줄이며, `history.max_bytes`가 있으면 오래된 line을 trim한다. 이 파일은 shell-like prompt recall용 text history이고, rollout JSONL은 thread replay/inspection용 full transcript다.

SQLite state DB는 rollout의 대체 원본이 아니라 index/cache 계층이다. `codex-rs/rollout/src/state_db.rs`는 thread metadata, rollout path, dynamic tools, memory mode, updated_at 등을 upsert하고, list/read fast path와 backfill/repair에 사용한다. 실제 turn reconstruction은 필요 시 rollout items를 읽어 수행한다.

## app-server, WebSocket, 외부 구독

외부 UI와 extension은 core `CodexThread`를 직접 폴링하지 않고 app-server protocol/transport를 통한다.

`codex-rs/app-server/src/thread_state.rs`의 `ThreadStateManager`는 connection id와 thread id의 구독 관계를 유지한다. `try_ensure_connection_subscribed(thread_id, connection_id, experimental_raw_events)`가 live connection을 thread에 붙이고, `subscribed_connection_ids(thread_id)`가 현재 구독자 목록을 반환한다. `ThreadState`는 listener cancellation handle, raw-event opt-in, pending interrupts, current-turn `ThreadHistoryBuilder`, last terminal turn id를 갖는다.

`codex-rs/app-server/src/codex_message_processor.rs`의 listener task는 `conversation.next_event()`를 await한다. event를 받으면 먼저 `ThreadState.track_current_turn_event`로 active turn snapshot을 갱신하고, 구독 connection id 목록을 읽어 `ThreadScopedOutgoingMessageSender`로 v2 notification을 보낸다. 이 경로가 app-server transport 위의 WebSocket/remote-control clients, desktop UI, VS Code extension류가 live turn 상태를 수신하는 기반이다.

`thread/read`는 persisted view와 live view를 합친다. `read_thread_view`는 먼저 `ThreadStore`에서 metadata/history를 읽고, `includeTurns`가 true면 rollout items를 `build_turns_from_rollout_items`로 v2 `Turn` 배열로 재구성한다. rollout이 아직 materialized되지 않은 ephemeral live thread는 `includeTurns`를 거부한다. live thread가 running이면 app-server thread watch 상태와 active turn snapshot을 반영해 stale turn을 interrupted 상태로 보정한다.

실시간 notification과 `thread/read` history는 같은 item builder/turn builder 계약을 공유한다. 즉 외부 client는 live WebSocket notification으로 진행 중 UI를 갱신하고, reconnect/resume/read 시 rollout/state DB에서 같은 thread/turn 모델을 재구성한다.

## 서브에이전트 주변 요소

`AgentControl`은 root session tree 범위의 subagent registry와 thread manager weak handle을 가진다. `spawn_agent`는 새 thread를 만들고 initial op를 submit한다.

`Mailbox`는 inter-agent communication을 mpsc queue에 넣고 watch sequence를 증가시킨다. `Session::get_pending_input`은 mailbox delivery phase가 current-turn일 때 mailbox mail을 response input으로 변환해 현재 sampling loop에 합친다.

완료 상태는 event 기반이다. `TurnStarted`, `TurnComplete`, `TurnAborted`, `Error`, `ShutdownComplete`가 `AgentStatus`로 변환되고 watch sender에 반영된다.
