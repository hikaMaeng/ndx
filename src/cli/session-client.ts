import type { SessionNotification } from "../session/client.js";
import type {
  RuntimeEventMsg,
  SessionConfiguredEvent,
} from "../shared/protocol.js";

export interface CliSessionRuntime {
  client: CliSessionTransport;
  cwd: string;
  print?: (message: string) => void;
  printError?: (message: string) => void;
}

export interface CliSessionTransport {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  onNotification(
    handler: (notification: SessionNotification) => void,
  ): () => void;
}

export interface InitializeResult {
  server?: string;
  protocolVersion?: number;
  methods?: string[];
}

export interface ThreadSummary {
  id: string;
  cwd: string;
  status: string;
  model: string;
  createdAt: number;
  updatedAt: number;
}

type CommandResult =
  | { handled: true; shouldExit: true }
  | { handled: true; shouldExit: false }
  | { handled: false };

/** CLI-side session-server client facade. */
export class CliSessionController {
  private readonly client: CliSessionTransport;
  private readonly cwd: string;
  private readonly print: (message: string) => void;
  private readonly printError: (message: string) => void;
  private initializeResult: InitializeResult | undefined;
  private thread: ThreadSummary | undefined;
  private sessionConfigured: SessionConfiguredEvent | undefined;
  private readonly recentEvents: RuntimeEventMsg[] = [];

  constructor(options: CliSessionRuntime) {
    this.client = options.client;
    this.cwd = options.cwd;
    this.print = options.print ?? console.log;
    this.printError = options.printError ?? console.error;
  }

  async initialize(): Promise<void> {
    this.initializeResult =
      await this.client.request<InitializeResult>("initialize");
    this.printError(formatInitializeResult(this.initializeResult));
  }

  async startThread(): Promise<string> {
    const response = await this.client.request<{ thread: ThreadSummary }>(
      "thread/start",
      { cwd: this.cwd },
    );
    this.thread = response.thread;
    this.printError(formatThreadStarted(response.thread));
    return response.thread.id;
  }

  async runPrompt(prompt: string): Promise<void> {
    const threadId = this.requireThreadId();
    const completion = new Promise<string>((resolve, reject) => {
      const off = this.client.onNotification((notification) => {
        const msg = runtimeEvent(notification);
        if (msg === undefined) {
          return;
        }
        this.rememberEvent(msg);
        if (msg.type === "session_configured") {
          this.sessionConfigured = msg;
          this.printError(formatSessionConfigured(msg));
          return;
        }
        if (msg.type === "tool_call") {
          this.printError(`[tool:${msg.name}] ${msg.arguments}`);
          return;
        }
        if (msg.type === "tool_result") {
          this.printError(`[tool:result] ${msg.output}`);
          return;
        }
        if (msg.type === "warning") {
          this.printError(`[warning] ${msg.message}`);
          return;
        }
        if (msg.type === "turn_complete") {
          off();
          resolve(msg.finalText);
          return;
        }
        if (msg.type === "turn_aborted") {
          off();
          reject(new Error(msg.reason));
          return;
        }
        if (msg.type === "error") {
          off();
          reject(new Error(msg.message));
        }
      });
    });
    await this.client.request("turn/start", { threadId, prompt });
    const text = await completion;
    if (text) {
      this.print(text);
    }
  }

  async handleCommand(input: string): Promise<CommandResult> {
    const command = input.trim();
    if (command === "/exit" || command === "/quit") {
      return { handled: true, shouldExit: true };
    }
    if (command === "/help") {
      this.print(interactiveHelp());
      return { handled: true, shouldExit: false };
    }
    if (command === "/status") {
      this.print(formatStatus(this.initializeResult, this.thread));
      return { handled: true, shouldExit: false };
    }
    if (command === "/init") {
      this.print(
        this.sessionConfigured === undefined
          ? "session initialization details have not arrived yet"
          : formatSessionConfigured(this.sessionConfigured),
      );
      return { handled: true, shouldExit: false };
    }
    if (command === "/events") {
      this.print(formatRecentEvents(this.recentEvents));
      return { handled: true, shouldExit: false };
    }
    if (command === "/interrupt") {
      await this.client.request("turn/interrupt", {
        threadId: this.requireThreadId(),
        reason: "interrupted from CLI",
      });
      this.print("interrupt requested");
      return { handled: true, shouldExit: false };
    }
    return { handled: false };
  }

  private requireThreadId(): string {
    if (this.thread === undefined) {
      throw new Error("thread has not been started");
    }
    return this.thread.id;
  }

  private rememberEvent(msg: RuntimeEventMsg): void {
    this.recentEvents.push(msg);
    if (this.recentEvents.length > 20) {
      this.recentEvents.shift();
    }
  }
}

export function printWelcomeLogo(
  printError: (message: string) => void = console.error,
): void {
  printError("ndx\nsession client");
}

export function interactiveHelp(): string {
  return [
    "Commands:",
    "  /help       Show this help",
    "  /status     Show socket, server, and thread status",
    "  /init       Show latest session initialization details",
    "  /events     Show recent runtime event types",
    "  /interrupt  Ask the session server to interrupt the active turn",
    "  /exit       Leave ndx",
    "",
    "Everything else is sent to the session server as a user turn.",
  ].join("\n");
}

export function runtimeEvent(
  notification: SessionNotification,
): RuntimeEventMsg | undefined {
  if (notification.params === null || typeof notification.params !== "object") {
    return undefined;
  }
  const event = (notification.params as { event?: unknown }).event;
  if (event === null || typeof event !== "object") {
    return undefined;
  }
  return event as RuntimeEventMsg;
}

function formatInitializeResult(result: InitializeResult): string {
  const server = result.server ?? "unknown";
  const protocol = result.protocolVersion ?? "unknown";
  const methods = result.methods?.join(", ") ?? "none";
  return [
    "[socket] connected",
    `[session-server] ${server}`,
    `[protocol] ${protocol}`,
    `[methods] ${methods}`,
  ].join("\n");
}

function formatThreadStarted(thread: ThreadSummary): string {
  return [
    `[thread] ${thread.id}`,
    `[cwd] ${thread.cwd}`,
    `[model] ${thread.model}`,
    `[status] ${thread.status}`,
  ].join("\n");
}

function formatSessionConfigured(event: SessionConfiguredEvent): string {
  const sources =
    event.sources.length === 0 ? "none" : event.sources.join(", ");
  return [
    "[session-init]",
    `  session: ${event.sessionId}`,
    `  cwd: ${event.cwd}`,
    `  model: ${event.model}`,
    `  approval: ${event.approvalPolicy}`,
    `  sandbox: ${event.sandboxMode}`,
    `  sources: ${sources}`,
  ].join("\n");
}

function formatStatus(
  initializeResult: InitializeResult | undefined,
  thread: ThreadSummary | undefined,
): string {
  const server = initializeResult?.server ?? "not initialized";
  const threadLine =
    thread === undefined
      ? "thread: not started"
      : `thread: ${thread.id} (${thread.status})`;
  return [`server: ${server}`, threadLine].join("\n");
}

function formatRecentEvents(events: RuntimeEventMsg[]): string {
  if (events.length === 0) {
    return "no runtime events received";
  }
  return events
    .map(
      (event, index) => `${String(index + 1).padStart(2, " ")}. ${event.type}`,
    )
    .join("\n");
}
