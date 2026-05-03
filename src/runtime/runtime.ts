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
  private history: ModelConversationItem[];
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

  replaceHistory(history: ModelConversationItem[]): void {
    this.history = [...history];
    this.context.restoredItems = history.length;
    const serialized = history.length === 0 ? "" : JSON.stringify(history);
    this.context.estimatedTokens = Math.ceil(serialized.length / 4);
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
  const serialized = history.length === 0 ? "" : JSON.stringify(history);
  return {
    restoredItems: history.length,
    estimatedTokens: Math.ceil(serialized.length / 4),
    maxContextTokens: config.activeModel.maxContext,
  };
}

interface ActiveTurn {
  turnId: string;
  controller: AbortController;
}
