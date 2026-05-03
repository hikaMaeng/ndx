import { randomUUID } from "node:crypto";
import { isAgentAbortError } from "./abort.js";
import { runAgent, type AgentEvent } from "../agent/loop.js";
import { classifyModelError } from "./errors.js";
import type {
  RuntimeEvent,
  RuntimeEventMsg,
  Submission,
} from "../shared/protocol.js";
import type {
  ModelClient,
  NdxBootstrapReport,
  NdxConfig,
  SessionContextSummary,
  SessionContextKindUsage,
} from "../shared/types.js";
import type { ModelConversationItem } from "../model/types.js";

export interface AgentRuntimeOptions {
  cwd: string;
  config: NdxConfig;
  client: ModelClient;
  sessionId?: string;
  history?: ModelConversationItem[];
  sources?: string[];
  bootstrap: NdxBootstrapReport;
}

export type RuntimeEventHandler = (event: RuntimeEvent) => void;

export class AgentRuntime {
  readonly sessionId: string;

  private readonly cwd: string;
  private readonly config: NdxConfig;
  private readonly client: ModelClient;
  private readonly sources: string[];
  private readonly bootstrap: NdxBootstrapReport;
  private readonly history: ModelConversationItem[];
  private readonly context: SessionContextSummary;
  private configured = false;
  private activeTurn: ActiveTurn | undefined;
  private readonly abortedTurnIds = new Set<string>();

  constructor(options: AgentRuntimeOptions) {
    this.sessionId = options.sessionId ?? randomUUID();
    this.cwd = options.cwd;
    this.config = options.config;
    this.client = options.client;
    this.history = options.history ?? [];
    this.sources = options.sources ?? [];
    this.bootstrap = options.bootstrap;
    this.context = summarizeContext(this.history, this.config);
  }

  async submit(
    submission: Submission,
    onEvent?: RuntimeEventHandler,
  ): Promise<string | undefined> {
    this.ensureConfigured(onEvent);

    if (submission.op.type === "interrupt") {
      const reason = submission.op.reason ?? "interrupted";
      this.interrupt(reason, onEvent);
      return undefined;
    }

    const turnId = submission.id;
    const cwd = submission.op.cwd ?? this.cwd;
    if (this.activeTurn !== undefined) {
      this.interrupt("replaced by a new user turn", onEvent);
    }
    const activeTurn = {
      turnId,
      controller: new AbortController(),
    };
    this.activeTurn = activeTurn;
    this.abortedTurnIds.delete(turnId);
    const historyBeforeTurn = [...this.history];
    this.history.push({
      type: "message",
      role: "user",
      content: submission.op.prompt,
    });
    this.emit(
      {
        type: "turn_started",
        sessionId: this.sessionId,
        turnId,
        prompt: submission.op.prompt,
        cwd,
      },
      onEvent,
    );

    try {
      const finalText = await runAgent({
        cwd,
        config: this.config,
        client: this.client,
        prompt: submission.op.prompt,
        history: historyBeforeTurn,
        signal: activeTurn.controller.signal,
        onEvent: (event) => this.forwardAgentEvent(turnId, event, onEvent),
      });

      if (activeTurn.controller.signal.aborted) {
        this.emitTurnAborted(
          turnId,
          String(activeTurn.controller.signal.reason ?? "interrupted"),
          onEvent,
        );
        return undefined;
      }

      this.emit(
        {
          type: "turn_complete",
          sessionId: this.sessionId,
          turnId,
          finalText,
        },
        onEvent,
      );
      return finalText;
    } catch (error) {
      if (isAgentAbortError(error)) {
        this.emitTurnAborted(turnId, error.message, onEvent);
        return undefined;
      }
      const classified = classifyModelError(error);
      this.emit(
        {
          type: "error",
          sessionId: this.sessionId,
          turnId,
          message: classified.message,
          code: classified.code,
          recoverable: classified.recoverable,
        },
        onEvent,
      );
      throw error;
    } finally {
      if (this.activeTurn?.turnId === turnId) {
        this.activeTurn = undefined;
      }
    }
  }

  async runPrompt(
    prompt: string,
    onEvent?: RuntimeEventHandler,
  ): Promise<string> {
    return (
      (await this.submit(
        {
          id: randomUUID(),
          op: { type: "user_turn", prompt, cwd: this.cwd },
        },
        onEvent,
      )) ?? ""
    );
  }

  interrupt(reason = "interrupted", onEvent?: RuntimeEventHandler): void {
    this.activeTurn?.controller.abort(reason);
    this.emitTurnAborted(this.activeTurn?.turnId, reason, onEvent);
  }

  contextSummary(): SessionContextSummary {
    return summarizeContext(this.history, this.config);
  }

  compactContext(
    mode: "compact" | "lite",
    onEvent?: RuntimeEventHandler,
  ): { before: SessionContextSummary; after: SessionContextSummary } {
    this.ensureConfigured(onEvent);
    const before = this.contextSummary();
    const keep = mode === "lite" ? 4 : 8;
    const replacement = compactHistory(this.history, keep, mode);
    this.history.splice(0, this.history.length, ...replacement);
    const after = this.contextSummary();
    this.emit(
      {
        type: "context_compacted",
        sessionId: this.sessionId,
        mode,
        before,
        after,
        replacement,
      },
      onEvent,
    );
    return { before, after };
  }

  private ensureConfigured(onEvent?: RuntimeEventHandler): void {
    if (this.configured) {
      return;
    }
    this.configured = true;
    this.emit(
      {
        type: "session_configured",
        sessionId: this.sessionId,
        model: this.config.model,
        cwd: this.cwd,
        approvalPolicy: "never",
        sandboxMode: this.config.permissions.defaultMode,
        sources: this.sources,
        bootstrap: this.bootstrap,
        context: this.context,
      },
      onEvent,
    );
  }

  private forwardAgentEvent(
    turnId: string,
    event: AgentEvent,
    onEvent?: RuntimeEventHandler,
  ): void {
    if (event.type === "model_text") {
      if (event.text.length > 0) {
        this.history.push({
          type: "message",
          role: "assistant",
          content: event.text,
        });
      }
      this.emit(
        {
          type: "agent_message",
          sessionId: this.sessionId,
          turnId,
          text: event.text,
        },
        onEvent,
      );
      return;
    }
    if (event.type === "tool_call") {
      this.history.push({
        type: "assistant_tool_calls",
        toolCalls: [
          {
            callId: event.callId,
            name: event.name,
            arguments: event.arguments,
          },
        ],
      });
      this.emit(
        {
          type: "tool_call",
          sessionId: this.sessionId,
          turnId,
          name: event.name,
          arguments: event.arguments,
        },
        onEvent,
      );
      return;
    }
    if (event.type === "tool_result") {
      this.history.push({
        type: "function_call_output",
        call_id: event.callId,
        output: event.output,
      });
      this.emit(
        {
          type: "tool_result",
          sessionId: this.sessionId,
          turnId,
          output: event.output,
        },
        onEvent,
      );
      return;
    }
    this.emit(
      {
        type: "token_count",
        sessionId: this.sessionId,
        turnId,
        usage: event.usage,
      },
      onEvent,
    );
  }

  private emitTurnAborted(
    turnId: string | undefined,
    reason: string,
    onEvent?: RuntimeEventHandler,
  ): void {
    if (turnId !== undefined) {
      if (this.abortedTurnIds.has(turnId)) {
        return;
      }
      this.abortedTurnIds.add(turnId);
    }
    this.emit(
      {
        type: "turn_aborted",
        sessionId: this.sessionId,
        turnId,
        reason,
      },
      onEvent,
    );
  }

  private emit(msg: RuntimeEventMsg, onEvent?: RuntimeEventHandler): void {
    onEvent?.({ id: randomUUID(), msg });
  }
}

function summarizeContext(
  history: ModelConversationItem[],
  config: NdxConfig,
): SessionContextSummary {
  const byKind = summarizeByKind(history);
  const estimatedTokens = byKind.reduce(
    (sum, entry) => sum + entry.estimatedTokens,
    0,
  );
  const maxContextTokens = config.activeModel.maxContext;
  return {
    restoredItems: history.length,
    items: history.length,
    estimatedTokens,
    maxContextTokens,
    remainingTokens:
      maxContextTokens === undefined
        ? undefined
        : Math.max(0, maxContextTokens - estimatedTokens),
    byKind,
  };
}

function summarizeByKind(
  history: ModelConversationItem[],
): SessionContextKindUsage[] {
  const entries = new Map<string, SessionContextKindUsage>();
  for (const item of history) {
    const kind = contextItemKind(item);
    const current = entries.get(kind) ?? {
      kind,
      items: 0,
      estimatedTokens: 0,
    };
    current.items += 1;
    current.estimatedTokens += estimateTokens(JSON.stringify(item));
    entries.set(kind, current);
  }
  return [...entries.values()].sort((left, right) =>
    left.kind.localeCompare(right.kind),
  );
}

function contextItemKind(item: ModelConversationItem): string {
  if (item.type === "message") {
    return `${item.role}_message`;
  }
  if (item.type === "assistant_tool_calls") {
    return "assistant_tool_calls";
  }
  return "tool_results";
}

function compactHistory(
  history: ModelConversationItem[],
  keep: number,
  mode: "compact" | "lite",
): ModelConversationItem[] {
  if (history.length <= keep) {
    return [...history];
  }
  const removed = history.slice(0, history.length - keep);
  const kept = history.slice(-keep);
  const removedKinds = summarizeByKind(removed)
    .map(
      (entry) =>
        `${entry.kind}: ${entry.items} items, ${entry.estimatedTokens} estimated tokens`,
    )
    .join("; ");
  return [
    {
      type: "message",
      role: "assistant",
      content: `[${mode} context summary] Removed ${removed.length} older context items. ${removedKinds}.`,
    },
    ...kept,
  ];
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface ActiveTurn {
  turnId: string;
  controller: AbortController;
}
