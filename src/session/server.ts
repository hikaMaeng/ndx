import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Socket } from "node:net";
import { basename, join, resolve } from "node:path";
import { ensureGlobalNdxHome } from "../config/index.js";
import { AgentRuntime } from "../runtime/runtime.js";
import { conversationHistoryFromRuntimeEvents } from "../runtime/history.js";
import { SessionLogStore } from "./log-store.js";
import {
  BUILT_IN_SLASH_COMMANDS,
  formatSlashCommandHelp,
  resolveSlashCommand,
  type SlashCommandExecution,
  type SlashCommandResult,
} from "./commands/registry.js";
import type { RuntimeEvent, RuntimeEventMsg } from "../shared/protocol.js";
import type {
  ModelClient,
  NdxBootstrapReport,
  NdxConfig,
} from "../shared/types.js";

type JsonRpcId = number | string | null;

const OWNER_LOCK_RETRY_DELAY_MS = 10;
const OWNER_LOCK_MAX_ATTEMPTS = 200;
const OWNER_LOCK_STALE_MS = 30_000;

interface JsonRpcRequest {
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

/** Construction options for the live ndx WebSocket session server. */
export interface SessionServerOptions {
  cwd: string;
  config: NdxConfig;
  sources?: string[];
  createClient: () => ModelClient;
  persistenceDir?: string;
}

/** Concrete loopback address chosen by the session server listener. */
export interface SessionServerAddress {
  host: string;
  port: number;
  url: string;
}

interface LiveSession {
  id: string;
  cwd: string;
  runtime: AgentRuntime;
  events: RuntimeEvent[];
  pendingEvents: RuntimeEvent[];
  discardedTurnIds: Set<string>;
  subscribers: Set<WebSocketConnection>;
  status: "idle" | "running" | "aborted" | "failed";
  createdAt: number;
  updatedAt: number;
  sequence?: number;
  title: string;
  persisted: boolean;
}

interface SessionListEntry {
  number: number;
  sequence: number;
  id: string;
  cwd: string;
  status: LiveSession["status"];
  createdAt: number;
  updatedAt: number;
  eventCount: number;
  live: boolean;
  title: string;
}

interface PersistedSessionState {
  id: string;
  cwd: string;
  status: LiveSession["status"];
  createdAt: number;
  updatedAt: number;
  events: RuntimeEvent[];
  sequence: number;
  title: string;
}

/** WebSocket JSON-RPC authority for live sessions, event fan-out, and JSONL. */
export class SessionServer {
  private readonly server: Server;
  private readonly options: SessionServerOptions;
  private readonly sessions = new Map<string, LiveSession>();
  private readonly clients = new Set<WebSocketConnection>();
  private readonly store: SessionLogStore;
  private readonly bootstrap: NdxBootstrapReport;
  private readonly serverId = randomUUID();
  private closing = false;

  constructor(options: SessionServerOptions) {
    this.options = options;
    this.bootstrap = ensureGlobalNdxHome(options.config.paths.globalDir);
    this.server = createServer();
    this.store = new SessionLogStore(
      options.persistenceDir ??
        join(options.config.paths.globalDir, "sessions", "ts-server"),
    );
    this.server.on("upgrade", (request, socket) => {
      this.handleUpgrade(request, socket as Socket);
    });
  }

  listen(port = 0, host = "127.0.0.1"): Promise<SessionServerAddress> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => {
        this.server.off("error", reject);
        const address = this.server.address();
        if (address === null || typeof address === "string") {
          reject(new Error("session server did not bind a TCP address"));
          return;
        }
        resolve({
          host,
          port: address.port,
          url: `ws://${host}:${address.port}`,
        });
      });
    });
  }

  async close(): Promise<void> {
    if (this.closing) {
      return;
    }
    this.closing = true;
    for (const client of this.clients) {
      client.close();
    }
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await this.store.close();
  }

  async flushPersistence(): Promise<void> {
    await this.store.flush();
  }

  private handleUpgrade(request: IncomingMessage, socket: Socket): void {
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n"),
    );

    const connection = new WebSocketConnection(socket, (message) => {
      void this.handleMessage(connection, message);
    });
    this.clients.add(connection);
    socket.on("close", () => {
      this.handleConnectionClose(connection);
    });
  }

  private async handleMessage(
    connection: WebSocketConnection,
    text: string,
  ): Promise<void> {
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(text) as JsonRpcRequest;
    } catch (error) {
      connection.sendJson({
        id: null,
        error: rpcError(-32700, "invalid JSON-RPC payload", error),
      });
      return;
    }

    if (request.id === undefined || typeof request.method !== "string") {
      connection.sendJson({
        id: request.id ?? null,
        error: rpcError(-32600, "request id and method are required"),
      });
      return;
    }

    try {
      const result = await this.dispatch(connection, request);
      connection.sendJson({ id: request.id, result });
    } catch (error) {
      connection.sendJson({
        id: request.id,
        error: rpcError(-32000, errorMessage(error), error),
      });
    }
  }

  private async dispatch(
    connection: WebSocketConnection,
    request: JsonRpcRequest,
  ): Promise<unknown> {
    switch (request.method) {
      case "initialize":
        return {
          server: "ndx-ts-session-server",
          protocolVersion: 1,
          bootstrap: this.bootstrap,
          methods: [
            "initialize",
            "command/list",
            "command/execute",
            "session/start",
            "session/list",
            "session/restore",
            "session/deleteCandidates",
            "session/delete",
            "session/subscribe",
            "session/read",
            "turn/start",
            "turn/interrupt",
          ],
        };
      case "command/list":
        return { commands: BUILT_IN_SLASH_COMMANDS };
      case "command/execute":
        return this.executeCommand(request.params);
      case "session/start":
        return this.startSession(connection, request.params);
      case "session/list":
        return this.listSessions(request.params);
      case "session/restore":
        return this.restoreSession(connection, request.params);
      case "session/deleteCandidates":
        return this.deleteSessionCandidates(request.params);
      case "session/delete":
        return this.deleteSession(request.params);
      case "session/subscribe":
        return this.subscribeSession(connection, request.params);
      case "session/read":
        return this.readSession(request.params);
      case "turn/start":
        return this.startTurn(connection, request.params);
      case "turn/interrupt":
        return this.interruptTurn(request.params);
      default:
        throw new Error(`unsupported session method: ${request.method}`);
    }
  }

  private async startSession(
    connection: WebSocketConnection,
    params: unknown,
  ): Promise<unknown> {
    const cwd = stringParam(params, "cwd") ?? this.options.cwd;
    const runtime = new AgentRuntime({
      cwd,
      config: this.options.config,
      client: this.options.createClient(),
      sources: this.options.sources,
      bootstrap: this.bootstrap,
    });
    const now = Date.now();
    const session: LiveSession = {
      id: runtime.sessionId,
      cwd,
      runtime,
      events: [],
      pendingEvents: [],
      discardedTurnIds: new Set(),
      subscribers: new Set([connection]),
      status: "idle",
      createdAt: now,
      updatedAt: now,
      title: "empty",
      persisted: false,
    };
    this.sessions.set(session.id, session);
    this.publishEphemeral(session, {
      method: "session/started",
      params: this.sessionSummary(session),
    });
    return {
      session: this.sessionSummary(session),
    };
  }

  private async subscribeSession(
    connection: WebSocketConnection,
    params: unknown,
  ): Promise<unknown> {
    const session = this.requiredSession(params);
    session.subscribers.add(connection);
    this.store.append(session.id, {
      type: "session_subscribed",
      sessionId: session.id,
      subscribedAt: Date.now(),
    });
    return {
      session: this.sessionSummary(session),
      events: session.events,
    };
  }

  private readSession(params: unknown): unknown {
    const session = this.requiredSession(params);
    return {
      session: this.sessionSummary(session),
      events: session.events,
    };
  }

  private listSessions(params: unknown): unknown {
    const cwd = stringParam(params, "cwd") ?? this.options.cwd;
    return { sessions: this.numberedSessionsForCwd(cwd) };
  }

  private deleteSessionCandidates(params: unknown): unknown {
    const cwd = stringParam(params, "cwd") ?? this.options.cwd;
    const currentSessionId = stringParam(params, "currentSessionId");
    return {
      sessions: this.deletableSessionsForCwd(cwd, currentSessionId),
    };
  }

  private deleteSession(params: unknown): unknown {
    const cwd = stringParam(params, "cwd") ?? this.options.cwd;
    const selector = requiredStringParam(params, "selector");
    const currentSessionId = stringParam(params, "currentSessionId");
    const deleted = this.deleteSessionBySelector(
      cwd,
      selector,
      currentSessionId,
    );
    return {
      session: deleted,
      message: `deleted session ${deleted.number}: ${deleted.title}`,
    };
  }

  private restoreSession(
    connection: WebSocketConnection,
    params: unknown,
  ): unknown {
    const cwd = stringParam(params, "cwd") ?? this.options.cwd;
    const selector = requiredStringParam(params, "selector");
    const session = this.restoreSessionBySelector(connection, cwd, selector);
    return {
      session: this.sessionSummary(session),
      events: session.events,
    };
  }

  private executeCommand(params: unknown): SlashCommandResult {
    const execution = slashCommandExecution(params);
    const definition = resolveSlashCommand(execution.name);
    if (definition === undefined) {
      return {
        handled: false,
        output: `unknown slash command: /${execution.name}`,
      };
    }
    if (!definition.implemented) {
      return {
        handled: false,
        output: `/${execution.name} is registered as ${definition.placement} but is not implemented in the TypeScript session server yet.`,
      };
    }

    switch (definition.name) {
      case "help":
        return {
          handled: true,
          action: "print",
          output: formatSlashCommandHelp(),
        };
      case "quit":
        return { handled: true, action: "exit" };
      case "status":
        return {
          handled: true,
          action: "print",
          output: this.formatCommandStatus(execution.sessionId),
        };
      case "init":
        return {
          handled: true,
          action: "print",
          output: this.formatLatestSessionConfigured(execution.sessionId),
        };
      case "events":
        return {
          handled: true,
          action: "print",
          output: this.formatRecentEvents(execution.sessionId),
        };
      case "session":
        return {
          handled: true,
          action: "print",
          output: this.formatSessions(execution.cwd ?? this.options.cwd),
        };
      case "restoreSession": {
        if (execution.args === undefined) {
          return {
            handled: true,
            action: "print",
            output: "usage: /restoreSession <session-id|session-number>",
          };
        }
        const session = this.restoreSessionBySelector(
          undefined,
          execution.cwd ?? this.options.cwd,
          execution.args.trim(),
        );
        return {
          handled: true,
          action: "restore",
          output: `restored session ${session.sequence}: ${session.title}\nid: ${session.id}\nstatus: ${session.status}`,
          session: this.sessionSummary(session),
        };
      }
      case "deleteSession": {
        if (execution.args === undefined) {
          return {
            handled: true,
            action: "deleteSession",
            output: this.formatDeleteSessions(
              execution.cwd ?? this.options.cwd,
              execution.sessionId,
            ),
          };
        }
        const deleted = this.deleteSessionBySelector(
          execution.cwd ?? this.options.cwd,
          execution.args.trim(),
          execution.sessionId,
        );
        return {
          handled: true,
          action: "deleteSession",
          output: `deleted session ${deleted.number}: ${deleted.title}\nid: ${deleted.id}`,
        };
      }
      case "interrupt":
        if (execution.sessionId === undefined) {
          throw new Error("sessionId is required for /interrupt");
        }
        this.interruptTurn({
          sessionId: execution.sessionId,
          reason: execution.args ?? "interrupted from CLI",
        });
        return {
          handled: true,
          action: "print",
          output: "interrupt requested",
        };
      default:
        return {
          handled: false,
          output: `/${definition.name} is registered but has no command handler.`,
        };
    }
  }

  private startTurn(
    connection: WebSocketConnection,
    params: unknown,
  ): Promise<unknown> {
    let session = this.requiredSession(params);
    const prompt = requiredStringParam(params, "prompt");
    if (this.terminateIfDeleted(session, "session was deleted")) {
      return Promise.resolve({ turn: { status: "deleted" } });
    }
    session = this.ensureOwnedSession(session, connection);
    if (this.terminateIfDeleted(session, "session was deleted")) {
      return Promise.resolve({ turn: { status: "deleted" } });
    }
    const cwd = stringParam(params, "cwd") ?? session.cwd;
    const turnId = randomUUID();
    session.subscribers.add(connection);
    this.ensureSessionPersisted(session, prompt);
    session.status = "running";
    session.updatedAt = Date.now();
    this.store.append(session.id, {
      type: "turn_start_requested",
      sessionId: session.id,
      turnId,
      prompt,
      cwd,
      requestedAt: session.updatedAt,
    });
    void session.runtime
      .submit(
        {
          id: turnId,
          op: { type: "user_turn", prompt, cwd },
        },
        (event) => this.handleRuntimeEvent(session, event),
      )
      .catch((error: unknown) => {
        session.status = "failed";
        session.updatedAt = Date.now();
        this.publish(session, {
          method: "error",
          params: {
            sessionId: session.id,
            turnId,
            message: errorMessage(error),
          },
        });
      });
    return Promise.resolve({ turn: { id: turnId, status: "in_progress" } });
  }

  private interruptTurn(params: unknown): Promise<unknown> {
    const session = this.requiredSession(params);
    const reason = stringParam(params, "reason") ?? "interrupted";
    session.runtime.interrupt(reason, (event) =>
      this.handleRuntimeEvent(session, event),
    );
    return Promise.resolve({
      session: this.sessionSummary(session),
    });
  }

  private handleRuntimeEvent(session: LiveSession, event: RuntimeEvent): void {
    const turnId = eventTurnId(event);
    if (turnId !== undefined && session.discardedTurnIds.has(turnId)) {
      return;
    }
    if (
      isTerminalEvent(event) &&
      this.terminateIfDeleted(
        session,
        "session was deleted before the response completed",
      )
    ) {
      return;
    }
    if (session.persisted && this.currentOwner(session.id) !== this.serverId) {
      session.pendingEvents = [];
      if (turnId !== undefined) {
        session.discardedTurnIds.add(turnId);
      }
      const reloaded = this.reloadAndAcquire(session);
      this.publishEphemeral(reloaded, {
        method: "session/ownershipChanged",
        params: {
          sessionId: reloaded.id,
          message:
            "session ownership changed during a turn; discarded stale live output and reloaded persisted context",
        },
      });
      return;
    }
    if (session.status === "running") {
      session.pendingEvents.push(event);
      this.publishEphemeral(
        session,
        runtimeNotification(session.id, event.msg),
      );
      if (isTerminalEvent(event)) {
        this.commitPendingEvents(session);
      }
      return;
    }
    this.commitRuntimeEvent(session, event, true);
  }

  private commitPendingEvents(session: LiveSession): void {
    const events = session.pendingEvents.splice(0);
    for (const event of events) {
      this.commitRuntimeEvent(session, event, false);
    }
  }

  private commitRuntimeEvent(
    session: LiveSession,
    event: RuntimeEvent,
    shouldPublish: boolean,
  ): void {
    session.events.push(event);
    session.updatedAt = Date.now();
    const msg = event.msg;
    if (msg.type === "turn_complete") {
      session.status = "idle";
    } else if (msg.type === "turn_aborted") {
      session.status = "aborted";
    } else if (msg.type === "error") {
      session.status = "failed";
    }
    this.store.append(session.id, {
      type: "runtime_event",
      sessionId: session.id,
      event,
      recordedAt: session.updatedAt,
    });
    const notification = runtimeNotification(session.id, msg);
    this.persistNotification(session, notification);
    if (shouldPublish) {
      this.publishEphemeral(session, notification);
    }
  }

  private publish(
    session: LiveSession,
    notification: JsonRpcNotification,
  ): void {
    this.persistNotification(session, notification);
    this.publishEphemeral(session, notification);
  }

  private persistNotification(
    session: LiveSession,
    notification: JsonRpcNotification,
  ): void {
    this.store.append(session.id, {
      type: "notification",
      sessionId: session.id,
      notification,
      recordedAt: Date.now(),
    });
  }

  private publishEphemeral(
    session: LiveSession,
    notification: JsonRpcNotification,
  ): void {
    for (const subscriber of session.subscribers) {
      subscriber.sendJson(notification);
    }
  }

  private handleConnectionClose(connection: WebSocketConnection): void {
    this.clients.delete(connection);
    for (const session of this.sessions.values()) {
      if (!session.subscribers.delete(connection)) {
        continue;
      }
      if (session.subscribers.size > 0 || !session.persisted) {
        continue;
      }
      session.updatedAt = Date.now();
      this.store.append(session.id, {
        type: "session_detached",
        sessionId: session.id,
        status: session.status,
        disconnectedAt: session.updatedAt,
      });
      void this.store.flush();
    }
  }

  private requiredSession(params: unknown): LiveSession {
    const sessionId = sessionIdParam(params);
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new Error(`unknown session: ${sessionId}`);
    }
    return session;
  }

  private restoreSessionBySelector(
    connection: WebSocketConnection | undefined,
    cwd: string,
    selector: string,
  ): LiveSession {
    const session = this.resolveSessionSelector(cwd, selector);
    const live = this.sessions.get(session.id);
    if (live !== undefined) {
      if (connection !== undefined) {
        live.subscribers.add(connection);
      }
      this.acquireOwnership(live);
      return live;
    }
    const persisted = this.readPersistedSession(session.id);
    if (persisted === undefined) {
      throw new Error(`unknown session: ${selector}`);
    }
    const runtime = new AgentRuntime({
      cwd: persisted.cwd,
      config: this.options.config,
      client: this.options.createClient(),
      sessionId: persisted.id,
      history: conversationHistoryFromRuntimeEvents(persisted.events),
      sources: this.options.sources,
      bootstrap: this.bootstrap,
    });
    const liveSession: LiveSession = {
      id: persisted.id,
      cwd: persisted.cwd,
      runtime,
      events: persisted.events,
      pendingEvents: [],
      discardedTurnIds: new Set(),
      subscribers: new Set(connection === undefined ? [] : [connection]),
      status: persisted.status,
      createdAt: persisted.createdAt,
      updatedAt: Date.now(),
      sequence: persisted.sequence,
      title: persisted.title,
      persisted: true,
    };
    this.sessions.set(liveSession.id, liveSession);
    this.acquireOwnership(liveSession);
    this.store.append(liveSession.id, {
      type: "session_restored",
      sessionId: liveSession.id,
      cwd: liveSession.cwd,
      restoredAt: liveSession.updatedAt,
    });
    if (connection !== undefined) {
      this.publish(liveSession, {
        method: "session/restored",
        params: this.sessionSummary(liveSession),
      });
    }
    return liveSession;
  }

  private resolveSessionSelector(
    cwd: string,
    selector: string,
  ): SessionListEntry {
    const sessions = this.numberedSessionsForCwd(cwd);
    const number = Number.parseInt(selector, 10);
    const selected =
      Number.isInteger(number) && String(number) === selector
        ? sessions.find((session) => session.number === number)
        : sessions.find((session) => session.id === selector);
    if (selected === undefined) {
      throw new Error(`unknown session for ${resolve(cwd)}: ${selector}`);
    }
    return selected;
  }

  private deleteSessionBySelector(
    cwd: string,
    selector: string,
    currentSessionId: string | undefined,
  ): SessionListEntry {
    const session = this.resolveSessionSelector(cwd, selector);
    if (session.id === currentSessionId) {
      throw new Error("cannot delete the current session");
    }
    const live = this.sessions.get(session.id);
    if (live !== undefined && live.subscribers.size > 0) {
      this.publishEphemeral(live, deletedSessionNotification(live.id));
      for (const subscriber of live.subscribers) {
        subscriber.close();
      }
    }
    this.sessions.delete(session.id);
    rmSync(this.sessionFile(session.id), { force: true });
    rmSync(this.ownerFile(session.id), { force: true });
    rmSync(`${this.ownerFile(session.id)}.lock`, {
      recursive: true,
      force: true,
    });
    return session;
  }

  private deletableSessionsForCwd(
    cwd: string,
    currentSessionId: string | undefined,
  ): SessionListEntry[] {
    return this.numberedSessionsForCwd(cwd).filter(
      (session) => session.id !== currentSessionId,
    );
  }

  private numberedSessionsForCwd(cwd: string): SessionListEntry[] {
    const normalizedCwd = resolve(cwd);
    const byId = new Map<string, Omit<SessionListEntry, "number">>();
    for (const persisted of this.readPersistedSessions()) {
      if (resolve(persisted.cwd) !== normalizedCwd) {
        continue;
      }
      byId.set(persisted.id, {
        id: persisted.id,
        sequence: persisted.sequence,
        cwd: persisted.cwd,
        status: persisted.status,
        createdAt: persisted.createdAt,
        updatedAt: persisted.updatedAt,
        eventCount: persisted.events.length,
        live: false,
        title: persisted.title,
      });
    }
    for (const session of this.sessions.values()) {
      if (!session.persisted || resolve(session.cwd) !== normalizedCwd) {
        continue;
      }
      byId.set(session.id, {
        id: session.id,
        sequence: session.sequence ?? this.nextSequenceForCwd(session.cwd),
        cwd: session.cwd,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        eventCount: session.events.length,
        live: true,
        title: session.title,
      });
    }
    return [...byId.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .map((session) => ({ number: session.sequence, ...session }));
  }

  private sessionSummary(session: LiveSession): unknown {
    return {
      id: session.id,
      sessionId: session.id,
      cwd: session.cwd,
      status: session.status,
      model: this.options.config.model,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      number: session.sequence,
      title: session.title,
    };
  }

  private formatCommandStatus(sessionId: string | undefined): string {
    const session =
      sessionId === undefined ? undefined : this.sessions.get(sessionId);
    const sessionLine =
      session === undefined
        ? "session: not started"
        : `session: ${session.sequence ?? "empty"} ${session.id} (${session.status})`;
    return ["server: ndx-ts-session-server", sessionLine].join("\n");
  }

  private formatLatestSessionConfigured(sessionId: string | undefined): string {
    const session =
      sessionId === undefined ? undefined : this.sessions.get(sessionId);
    const event = session?.events
      .map((record) => record.msg)
      .findLast((msg) => msg.type === "session_configured");
    if (event === undefined || event.type !== "session_configured") {
      return "session initialization details have not arrived yet";
    }
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
      formatBootstrap(event.bootstrap),
    ].join("\n");
  }

  private formatRecentEvents(sessionId: string | undefined): string {
    const session =
      sessionId === undefined ? undefined : this.sessions.get(sessionId);
    if (session === undefined || session.events.length === 0) {
      return "no runtime events received";
    }
    return session.events
      .slice(-20)
      .map(
        (event, index) =>
          `${String(index + 1).padStart(2, " ")}. ${event.msg.type}`,
      )
      .join("\n");
  }

  private formatSessions(cwd: string): string {
    const sessions = this.numberedSessionsForCwd(cwd);
    if (sessions.length === 0) {
      return [`sessions for ${resolve(cwd)}`, "0. new session"].join("\n");
    }
    return [
      `sessions for ${resolve(cwd)}`,
      "0. new session",
      ...sessions.map((session) =>
        [
          `${session.number}. ${session.title}`,
          `id: ${session.id}`,
          `updated: ${new Date(session.updatedAt).toISOString()}`,
          `status: ${session.status}`,
          `events: ${session.eventCount}`,
          session.live ? "live" : "saved",
        ].join(" | "),
      ),
    ].join("\n");
  }

  private formatDeleteSessions(
    cwd: string,
    currentSessionId: string | undefined,
  ): string {
    const sessions = this.deletableSessionsForCwd(cwd, currentSessionId);
    if (sessions.length === 0) {
      return [
        `delete sessions for ${resolve(cwd)}`,
        "no deletable sessions",
      ].join("\n");
    }
    return [
      `delete sessions for ${resolve(cwd)}`,
      ...sessions.map((session) =>
        [
          `${session.number}. ${session.title}`,
          `id: ${session.id}`,
          `updated: ${new Date(session.updatedAt).toISOString()}`,
          `status: ${session.status}`,
          `events: ${session.eventCount}`,
          session.live ? "live" : "saved",
        ].join(" | "),
      ),
      "Press Enter without a number to cancel.",
    ].join("\n");
  }

  private readPersistedSessions(): PersistedSessionState[] {
    const dir = this.persistenceDir();
    if (!existsSync(dir)) {
      return [];
    }
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => this.readPersistedSession(basename(entry.name, ".jsonl")))
      .filter(
        (session): session is PersistedSessionState => session !== undefined,
      );
  }

  private readPersistedSession(
    sessionId: string,
  ): PersistedSessionState | undefined {
    const file = this.sessionFile(sessionId);
    if (!existsSync(file)) {
      return undefined;
    }
    const records = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    let cwd: string | undefined;
    let createdAt: number | undefined;
    let updatedAt = 0;
    let status: LiveSession["status"] = "idle";
    let sequence: number | undefined;
    let title = "empty";
    const events: RuntimeEvent[] = [];
    for (const record of records) {
      const recordTime = recordTimestamp(record);
      updatedAt = Math.max(updatedAt, recordTime);
      if (record.type === "session_started") {
        cwd = typeof record.cwd === "string" ? record.cwd : cwd;
        createdAt =
          typeof record.createdAt === "number" ? record.createdAt : createdAt;
        sequence =
          typeof record.sequence === "number" ? record.sequence : sequence;
        title = typeof record.title === "string" ? record.title : title;
      } else if (record.type === "session_title_updated") {
        title = typeof record.title === "string" ? record.title : title;
      } else if (record.type === "runtime_event") {
        const event = record.event;
        if (isRuntimeEvent(event)) {
          events.push(event);
          status = statusFromEvent(event, status);
          if (event.msg.type === "turn_started") {
            cwd = event.msg.cwd;
          } else if (event.msg.type === "session_configured") {
            cwd = event.msg.cwd;
          }
        }
      } else if (record.type === "session_detached") {
        status = parseThreadStatus(record.status) ?? status;
      }
    }
    if (cwd === undefined || sequence === undefined) {
      return undefined;
    }
    return {
      id: sessionId,
      cwd,
      status,
      createdAt: createdAt ?? updatedAt,
      updatedAt,
      events,
      sequence,
      title,
    };
  }

  private ensureSessionPersisted(session: LiveSession, prompt: string): void {
    if (session.persisted) {
      return;
    }
    const now = Date.now();
    const sequence = this.nextSequenceForCwd(session.cwd);
    session.sequence = sequence;
    session.title = titleFromPrompt(prompt);
    session.createdAt = now;
    session.updatedAt = now;
    session.persisted = true;
    this.acquireOwnership(session);
    this.store.append(session.id, {
      type: "session_started",
      sessionId: session.id,
      cwd: session.cwd,
      sequence,
      title: session.title,
      createdAt: now,
    });
  }

  private nextSequenceForCwd(cwd: string): number {
    const normalizedCwd = resolve(cwd);
    const maxSequence = this.readPersistedSessions()
      .filter((session) => resolve(session.cwd) === normalizedCwd)
      .reduce((max, session) => Math.max(max, session.sequence), 0);
    return maxSequence + 1;
  }

  private ensureOwnedSession(
    session: LiveSession,
    connection: WebSocketConnection,
  ): LiveSession {
    if (!session.persisted) {
      return session;
    }
    if (!this.sessionFileExists(session.id)) {
      this.terminateDeletedSession(session, "session was deleted");
      return session;
    }
    const owner = this.currentOwner(session.id);
    if (owner === undefined || owner === this.serverId) {
      this.acquireOwnership(session);
      return session;
    }
    const reloaded = this.reloadAndAcquire(session);
    reloaded.subscribers.add(connection);
    this.publishEphemeral(reloaded, {
      method: "session/ownershipChanged",
      params: {
        sessionId: reloaded.id,
        message:
          "session ownership changed; reloaded persisted context before handling the prompt",
      },
    });
    return reloaded;
  }

  private reloadAndAcquire(session: LiveSession): LiveSession {
    const persisted = this.readPersistedSession(session.id);
    if (persisted === undefined) {
      this.acquireOwnership(session);
      return session;
    }
    const reloaded: LiveSession = {
      id: persisted.id,
      cwd: persisted.cwd,
      runtime: new AgentRuntime({
        cwd: persisted.cwd,
        config: this.options.config,
        client: this.options.createClient(),
        sessionId: persisted.id,
        history: conversationHistoryFromRuntimeEvents(persisted.events),
        sources: this.options.sources,
        bootstrap: this.bootstrap,
      }),
      events: persisted.events,
      pendingEvents: [],
      discardedTurnIds: new Set(),
      subscribers: session.subscribers,
      status: persisted.status,
      createdAt: persisted.createdAt,
      updatedAt: Date.now(),
      sequence: persisted.sequence,
      title: persisted.title,
      persisted: true,
    };
    this.sessions.set(reloaded.id, reloaded);
    this.acquireOwnership(reloaded);
    return reloaded;
  }

  private acquireOwnership(session: LiveSession): void {
    if (!session.persisted) {
      return;
    }
    this.withOwnerLock(session.id, () => {
      const owner = {
        sessionId: session.id,
        serverId: this.serverId,
        claimedAt: Date.now(),
      };
      const file = this.ownerFile(session.id);
      const temp = `${file}.${process.pid}.${this.serverId}.${randomUUID()}.tmp`;
      writeFileSync(temp, JSON.stringify(owner));
      renameSync(temp, file);
    });
  }

  private currentOwner(sessionId: string): string | undefined {
    return this.withOwnerLock(sessionId, () => {
      const file = this.ownerFile(sessionId);
      if (!existsSync(file)) {
        return undefined;
      }
      try {
        const value = JSON.parse(readFileSync(file, "utf8")) as {
          serverId?: unknown;
        };
        return typeof value.serverId === "string" ? value.serverId : undefined;
      } catch {
        return undefined;
      }
    });
  }

  private withOwnerLock<T>(sessionId: string, action: () => T): T {
    mkdirSync(this.ownerDir(), { recursive: true });
    const lockDir = `${this.ownerFile(sessionId)}.lock`;
    let lastError: unknown;
    for (let attempt = 0; attempt < OWNER_LOCK_MAX_ATTEMPTS; attempt += 1) {
      try {
        mkdirSync(lockDir);
      } catch (error) {
        lastError = error;
        if (isFileSystemError(error, "EEXIST")) {
          this.removeStaleOwnerLock(lockDir);
          sleepSync(OWNER_LOCK_RETRY_DELAY_MS);
          continue;
        }
        if (
          isFileSystemError(error, "EBUSY") ||
          isFileSystemError(error, "EPERM") ||
          isFileSystemError(error, "EACCES") ||
          isFileSystemError(error, "ENOENT")
        ) {
          mkdirSync(this.ownerDir(), { recursive: true });
          sleepSync(OWNER_LOCK_RETRY_DELAY_MS);
          continue;
        }
        throw error;
      }
      try {
        return action();
      } finally {
        rmSync(lockDir, { recursive: true, force: true });
      }
    }
    throw new Error(
      `timed out waiting for session ownership file lock: ${sessionId}`,
      { cause: lastError },
    );
  }

  private removeStaleOwnerLock(lockDir: string): void {
    try {
      const ageMs = Date.now() - statSync(lockDir).mtimeMs;
      if (ageMs > OWNER_LOCK_STALE_MS) {
        rmSync(lockDir, { recursive: true, force: true });
      }
    } catch (error) {
      if (!isFileSystemError(error, "ENOENT")) {
        throw error;
      }
    }
  }

  private persistenceDir(): string {
    return (
      this.options.persistenceDir ??
      join(this.options.config.paths.globalDir, "sessions", "ts-server")
    );
  }

  private sessionFile(sessionId: string): string {
    return join(this.persistenceDir(), `${sessionId}.jsonl`);
  }

  private sessionFileExists(sessionId: string): boolean {
    return existsSync(this.sessionFile(sessionId));
  }

  private terminateIfDeleted(session: LiveSession, message: string): boolean {
    if (!session.persisted || this.sessionFileExists(session.id)) {
      return false;
    }
    this.terminateDeletedSession(session, message);
    return true;
  }

  private terminateDeletedSession(session: LiveSession, message: string): void {
    this.publishEphemeral(
      session,
      deletedSessionNotification(session.id, message),
    );
    for (const subscriber of session.subscribers) {
      subscriber.close();
    }
    this.sessions.delete(session.id);
    setImmediate(() => {
      void this.close().catch(() => undefined);
    });
  }

  private ownerDir(): string {
    return join(this.persistenceDir(), "owners");
  }

  private ownerFile(sessionId: string): string {
    return join(this.ownerDir(), `${sessionId}.json`);
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function sleepSync(ms: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, ms);
}

class WebSocketConnection {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  constructor(
    private readonly socket: Socket,
    private readonly onText: (message: string) => void,
  ) {
    socket.on("data", (chunk) => this.handleData(chunk));
  }

  sendJson(payload: unknown): void {
    if (this.socket.destroyed || this.socket.writableEnded) {
      return;
    }
    this.socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify(payload))));
  }

  close(): void {
    if (!this.socket.destroyed && !this.socket.writableEnded) {
      this.socket.end(encodeFrame(0x8, Buffer.alloc(0)));
    }
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const frame = readFrame(this.buffer);
      if (frame === undefined) {
        return;
      }
      this.buffer = frame.remaining;
      if (frame.opcode === 0x8) {
        this.close();
        return;
      }
      if (frame.opcode === 0x9) {
        this.socket.write(encodeFrame(0xa, frame.payload));
        continue;
      }
      if (frame.opcode !== 0x1) {
        continue;
      }
      this.onText(frame.payload.toString("utf8"));
    }
  }
}

interface DecodedFrame {
  opcode: number;
  payload: Buffer;
  remaining: Buffer;
}

function readFrame(buffer: Buffer): DecodedFrame | undefined {
  if (buffer.length < 2) {
    return undefined;
  }
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) {
      return undefined;
    }
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) {
      return undefined;
    }
    const bigLength = buffer.readBigUInt64BE(offset);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("WebSocket frame is too large");
    }
    length = Number(bigLength);
    offset += 8;
  }
  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + length) {
    return undefined;
  }
  const mask = masked ? buffer.subarray(offset, offset + 4) : undefined;
  offset += maskLength;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask !== undefined) {
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] ^= mask[i % 4];
    }
  }
  return {
    opcode,
    payload,
    remaining: buffer.subarray(offset + length),
  };
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  if (length < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, length]), payload]);
  }
  if (length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

function runtimeNotification(
  sessionId: string,
  msg: RuntimeEventMsg,
): JsonRpcNotification {
  const params = { sessionId, event: msg };
  switch (msg.type) {
    case "session_configured":
      return { method: "session/configured", params };
    case "turn_started":
      return { method: "turn/started", params };
    case "agent_message":
      return { method: "item/agentMessage", params };
    case "tool_call":
      return { method: "item/toolCall", params };
    case "tool_result":
      return { method: "item/toolResult", params };
    case "token_count":
      return { method: "session/tokenUsage/updated", params };
    case "turn_complete":
      return { method: "turn/completed", params };
    case "turn_aborted":
      return { method: "turn/aborted", params };
    case "warning":
      return { method: "warning", params };
    case "error":
      return { method: "error", params };
  }
}

function deletedSessionNotification(
  sessionId: string,
  message = "session was deleted",
): JsonRpcNotification {
  return {
    method: "session/deleted",
    params: {
      sessionId,
      message,
    },
  };
}

function requiredStringParam(params: unknown, name: string): string {
  const value = stringParam(params, name);
  if (value === undefined) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function sessionIdParam(params: unknown): string {
  return stringParam(params, "sessionId") ?? requiredStringParam(params, "id");
}

function stringParam(params: unknown, name: string): string | undefined {
  if (params === null || typeof params !== "object") {
    return undefined;
  }
  const value = (params as Record<string, unknown>)[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function slashCommandExecution(params: unknown): SlashCommandExecution {
  const name = requiredStringParam(params, "name");
  if (name.startsWith("/")) {
    throw new Error("command name must not include a leading slash");
  }
  return {
    name,
    args: stringParam(params, "args"),
    sessionId: stringParam(params, "sessionId"),
    cwd: stringParam(params, "cwd"),
  };
}

function titleFromPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return "empty";
  }
  return normalized.length > 64 ? `${normalized.slice(0, 61)}...` : normalized;
}

function recordTimestamp(record: Record<string, unknown>): number {
  for (const key of [
    "recordedAt",
    "requestedAt",
    "disconnectedAt",
    "restoredAt",
    "subscribedAt",
    "createdAt",
    "persistedAt",
  ]) {
    const value = record[key];
    if (typeof value === "number") {
      return value;
    }
  }
  return 0;
}

function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const event = value as { id?: unknown; msg?: unknown };
  return (
    typeof event.id === "string" &&
    event.msg !== null &&
    typeof event.msg === "object"
  );
}

function statusFromEvent(
  event: RuntimeEvent,
  fallback: LiveSession["status"],
): LiveSession["status"] {
  switch (event.msg.type) {
    case "turn_started":
      return "running";
    case "turn_complete":
      return "idle";
    case "turn_aborted":
      return "aborted";
    case "error":
      return "failed";
    default:
      return fallback;
  }
}

function isTerminalEvent(event: RuntimeEvent): boolean {
  return (
    event.msg.type === "turn_complete" ||
    event.msg.type === "turn_aborted" ||
    event.msg.type === "error"
  );
}

function eventTurnId(event: RuntimeEvent): string | undefined {
  const value = (event.msg as { turnId?: unknown }).turnId;
  return typeof value === "string" ? value : undefined;
}

function parseThreadStatus(value: unknown): LiveSession["status"] | undefined {
  return value === "idle" ||
    value === "running" ||
    value === "aborted" ||
    value === "failed"
    ? value
    : undefined;
}

function rpcError(code: number, message: string, data?: unknown): JsonRpcError {
  return { code, message, data: data instanceof Error ? data.message : data };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBootstrap(bootstrap: NdxBootstrapReport): string {
  const installed = bootstrap.elements.filter(
    (element) => element.status === "installed",
  );
  const existing = bootstrap.elements.length - installed.length;
  const rows = bootstrap.elements.map(
    (element) => `  ${element.status}: ${element.name} (${element.path})`,
  );
  return [
    `[bootstrap] ${bootstrap.globalDir}`,
    `  installed: ${installed.length}`,
    `  existing: ${existing}`,
    ...rows,
  ].join("\n");
}
