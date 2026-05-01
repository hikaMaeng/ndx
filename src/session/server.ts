import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdirSync, readdirSync } from "node:fs";
import type { Socket } from "node:net";
import { join, resolve } from "node:path";
import {
  configForModel,
  defaultModelEffort,
  defaultModelThink,
  ensureGlobalNdxHome,
} from "../config/index.js";
import { AgentRuntime } from "../runtime/runtime.js";
import { conversationHistoryFromRuntimeEvents } from "../runtime/history.js";
import {
  SqliteSessionStore,
  type StoredSession,
  type StoredSessionListEntry,
} from "./sqlite-store.js";
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
  ModelSettings,
  NdxBootstrapReport,
  NdxConfig,
} from "../shared/types.js";
import {
  ensureDockerSandbox,
  hostPathToSandboxPath,
  type DockerSandboxState,
} from "./docker-sandbox.js";

type JsonRpcId = number | string | null;

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
  createClient: (config: NdxConfig) => ModelClient;
  dataDir?: string;
  persistenceDir?: string;
  requireDockerSandbox?: boolean;
  dockerSandboxImage?: string;
}

/** Concrete loopback address chosen by the session server listener. */
export interface SessionServerAddress {
  host: string;
  port: number;
  url: string;
  dashboardHost?: string;
  dashboardPort?: number;
  dashboardUrl?: string;
}

interface LiveSession {
  id: string;
  user: string;
  clientIds: Set<string>;
  logKey?: string;
  cwd: string;
  config: NdxConfig;
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
  user: string;
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
  user: string;
  logKey: string;
  cwd: string;
  status: LiveSession["status"];
  createdAt: number;
  updatedAt: number;
  events: RuntimeEvent[];
  sequence: number;
  title: string;
}

/** WebSocket JSON-RPC authority for live sessions, event fan-out, and SQLite. */
export class SessionServer {
  private readonly server: Server;
  private readonly dashboardServer: Server;
  private readonly options: SessionServerOptions;
  private readonly sessions = new Map<string, LiveSession>();
  private readonly clients = new Set<WebSocketConnection>();
  private readonly store: SqliteSessionStore;
  private readonly bootstrap: NdxBootstrapReport;
  private readonly serverId = randomUUID();
  private readonly sandboxes = new Map<string, DockerSandboxState>();
  private closing = false;

  constructor(options: SessionServerOptions) {
    this.options = options;
    this.bootstrap = ensureGlobalNdxHome(options.config.paths.globalDir);
    this.server = createServer();
    this.dashboardServer = createServer();
    this.store = SqliteSessionStore.open(
      options.dataDir ??
        options.persistenceDir ??
        options.config.paths.dataDir ??
        "/home/.ndx/system",
    );
    this.server.on("upgrade", (request, socket) => {
      this.handleUpgrade(request, socket as Socket);
    });
    this.server.on("request", (_request, response) => {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("ndx socket server\n");
    });
    this.dashboardServer.on("request", (request, response) => {
      if (request.url === "/" || request.url === "/dashboard") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
        });
        response.end(DASHBOARD_HTML);
        return;
      }
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found\n");
    });
  }

  private nextSessionConfig(): NdxConfig {
    return this.options.config;
  }

  private configForPersistedSession(session: PersistedSessionState): NdxConfig {
    void session;
    return this.options.config;
  }

  private clientContext(
    connection: WebSocketConnection | undefined,
    params: unknown,
  ): { user: string; clientId: string } {
    const user =
      connection?.authenticated === true
        ? connection.user
        : (stringParam(params, "user") ?? connection?.user ?? "defaultUser");
    const clientId: string =
      stringParam(params, "clientId") ?? connection?.clientId ?? randomUUID();
    if (connection !== undefined) {
      connection.user = user;
      connection.clientId = clientId;
    }
    return { user, clientId };
  }

  async listen(
    port = 0,
    host = "127.0.0.1",
    dashboardPort = 0,
    dashboardHost = host,
  ): Promise<SessionServerAddress> {
    if (this.options.requireDockerSandbox === true) {
      await this.ensureWorkspaceSandbox(this.options.cwd);
    }
    const socket = await listenHttp(this.server, port, host, "session server");
    const dashboard = await listenHttp(
      this.dashboardServer,
      dashboardPort,
      dashboardHost,
      "dashboard server",
    );
    return {
      host,
      port: socket.port,
      url: `ws://${host}:${socket.port}`,
      dashboardHost,
      dashboardPort: dashboard.port,
      dashboardUrl: `http://${dashboardHost}:${dashboard.port}`,
    };
  }

  async close(): Promise<void> {
    if (this.closing) {
      return;
    }
    this.closing = true;
    for (const client of this.clients) {
      client.close();
      client.destroy();
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
    await new Promise<void>((resolve, reject) => {
      this.dashboardServer.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    this.store.close();
  }

  async flushPersistence(): Promise<void> {
    await Promise.resolve();
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
    if (!isPublicMethod(request.method) && !connection.authenticated) {
      return null;
    }
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
            "account/create",
            "account/login",
            "account/socialLogin",
            "account/delete",
            "account/changePassword",
            "project/list",
            "project/create",
          ],
        };
      case "account/create":
        return this.createAccount(request.params);
      case "account/login":
        return this.loginAccount(connection, request.params);
      case "account/socialLogin":
        return this.loginSocialAccount(connection, request.params);
      case "account/delete":
        return this.deleteAccount(request.params);
      case "account/changePassword":
        return this.changeAccountPassword(request.params);
      case "project/list":
        return this.listProjects();
      case "project/create":
        return this.createProject(request.params);
      case "command/list":
        return { commands: BUILT_IN_SLASH_COMMANDS };
      case "command/execute":
        return this.executeCommand(connection, request.params);
      case "session/start":
        return this.startSession(connection, request.params);
      case "session/list":
        return this.listSessions(connection, request.params);
      case "session/restore":
        return this.restoreSession(connection, request.params);
      case "session/deleteCandidates":
        return this.deleteSessionCandidates(connection, request.params);
      case "session/delete":
        return this.deleteSession(connection, request.params);
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
    const context = this.clientContext(connection, params);
    const cwd = stringParam(params, "cwd") ?? this.options.cwd;
    const sandbox = await this.ensureWorkspaceSandbox(cwd);
    const config = this.configWithSandbox(
      this.nextSessionConfig(),
      sandbox,
      cwd,
    );
    const runtime = new AgentRuntime({
      cwd,
      config,
      client: this.options.createClient(config),
      sources: this.options.sources,
      bootstrap: this.bootstrap,
    });
    const now = Date.now();
    const session: LiveSession = {
      id: runtime.sessionId,
      user: context.user,
      clientIds: new Set([context.clientId]),
      cwd,
      config,
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

  private createAccount(params: unknown): unknown {
    const username = requiredStringParam(params, "username");
    const password = stringParam(params, "password") ?? "";
    if (this.store.accountExists(username)) {
      throw new Error(`account already exists: ${username}`);
    }
    return {
      username,
      createdAt: this.store.createAccount(username, password),
    };
  }

  private loginAccount(
    connection: WebSocketConnection,
    params: unknown,
  ): unknown {
    const username = stringParam(params, "username") ?? "defaultUser";
    const password = stringParam(params, "password") ?? "";
    const clientId: string = stringParam(params, "clientId") ?? randomUUID();
    if (!this.store.validateAccount(username, password)) {
      throw new Error("invalid account credentials");
    }
    connection.user = username;
    connection.clientId = clientId;
    connection.authenticated = true;
    return {
      username,
      clientId,
      sessionRoot: this.dataDir(),
    };
  }

  private async loginSocialAccount(
    connection: WebSocketConnection,
    params: unknown,
  ): Promise<unknown> {
    const provider = requiredStringParam(params, "provider");
    const accessToken = requiredStringParam(params, "accessToken");
    const suppliedSubject = stringParam(params, "subject");
    const clientId: string = stringParam(params, "clientId") ?? randomUUID();
    const profile = await verifiedSocialProfile(provider, accessToken);
    if (
      suppliedSubject !== undefined &&
      suppliedSubject.length > 0 &&
      suppliedSubject !== profile.subject
    ) {
      throw new Error("social login subject does not match access token");
    }
    const account = this.store.upsertSocialAccount({
      provider,
      subject: profile.subject,
      email: profile.email ?? stringParam(params, "email"),
      displayName: profile.displayName ?? stringParam(params, "displayName"),
      accessToken,
      refreshToken: stringParam(params, "refreshToken"),
    });
    connection.user = account.username;
    connection.clientId = clientId;
    connection.authenticated = true;
    return {
      username: account.username,
      clientId,
      sessionRoot: this.dataDir(),
      provider,
      created: account.created,
    };
  }

  private deleteAccount(params: unknown): unknown {
    const username = requiredStringParam(params, "username");
    if (username === "defaultUser") {
      throw new Error("defaultUser cannot be deleted");
    }
    const deleted = this.store.deleteAccount(username);
    return { username, deleted };
  }

  private changeAccountPassword(params: unknown): unknown {
    const username = requiredStringParam(params, "username");
    const oldPassword = stringParam(params, "oldPassword") ?? "";
    const newPassword = requiredStringParam(params, "newPassword");
    return {
      username,
      updatedAt: this.store.changePassword(username, oldPassword, newPassword),
    };
  }

  private listProjects(): unknown {
    const root = resolve(this.options.cwd);
    const projects = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => ({
        name: entry.name,
        cwd: join(root, entry.name),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    return { root, projects };
  }

  private createProject(params: unknown): unknown {
    const root = resolve(this.options.cwd);
    const name = requiredStringParam(params, "name");
    if (
      name.includes("/") ||
      name.includes("\\") ||
      name === "." ||
      name === ".."
    ) {
      throw new Error(`invalid project name: ${name}`);
    }
    const cwd = join(root, name);
    mkdirSync(cwd, { recursive: true });
    return { project: { name, cwd } };
  }

  private async ensureWorkspaceSandbox(
    cwd: string,
  ): Promise<DockerSandboxState | undefined> {
    if (this.options.requireDockerSandbox !== true) {
      return undefined;
    }
    const workspaceDir = resolve(cwd);
    const existing = this.sandboxes.get(workspaceDir);
    if (existing !== undefined) {
      return existing;
    }
    const sandbox = await ensureDockerSandbox({
      workspaceDir,
      image:
        this.options.dockerSandboxImage ??
        this.options.config.tools.dockerSandboxImage,
    });
    this.sandboxes.set(workspaceDir, sandbox);
    return sandbox;
  }

  private configWithSandbox(
    config: NdxConfig,
    sandbox: DockerSandboxState | undefined,
    cwd: string,
  ): NdxConfig {
    if (sandbox === undefined) {
      return config;
    }
    return {
      ...config,
      env: {
        ...config.env,
        NDX_SANDBOX_CONTAINER: sandbox.containerName,
        NDX_SANDBOX_HOST_WORKSPACE: sandbox.workspaceDir,
        NDX_SANDBOX_WORKSPACE: sandbox.containerWorkspaceDir,
        NDX_SANDBOX_CWD: hostPathToSandboxPath(sandbox, cwd),
      },
    };
  }

  private async subscribeSession(
    connection: WebSocketConnection,
    params: unknown,
  ): Promise<unknown> {
    const context = this.clientContext(connection, params);
    const session = this.requiredSession(params);
    if (session.user !== context.user) {
      throw new Error(
        `unknown session for user ${context.user}: ${session.id}`,
      );
    }
    session.clientIds.add(context.clientId);
    session.subscribers.add(connection);
    this.appendSessionRecord(session, {
      type: "session_subscribed",
      sessionId: session.id,
      user: session.user,
      clientId: context.clientId,
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

  private listSessions(
    connection: WebSocketConnection,
    params: unknown,
  ): unknown {
    const context = this.clientContext(connection, params);
    const cwd = stringParam(params, "cwd") ?? this.options.cwd;
    return { sessions: this.numberedSessionsForCwd(context.user, cwd) };
  }

  private deleteSessionCandidates(
    connection: WebSocketConnection,
    params: unknown,
  ): unknown {
    const context = this.clientContext(connection, params);
    const cwd = stringParam(params, "cwd") ?? this.options.cwd;
    const currentSessionId = stringParam(params, "currentSessionId");
    return {
      sessions: this.deletableSessionsForCwd(
        context.user,
        cwd,
        currentSessionId,
      ),
    };
  }

  private deleteSession(
    connection: WebSocketConnection,
    params: unknown,
  ): unknown {
    const context = this.clientContext(connection, params);
    const cwd = stringParam(params, "cwd") ?? this.options.cwd;
    const selector = requiredStringParam(params, "selector");
    const currentSessionId = stringParam(params, "currentSessionId");
    const deleted = this.deleteSessionBySelector(
      context.user,
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
    const context = this.clientContext(connection, params);
    const cwd = stringParam(params, "cwd") ?? this.options.cwd;
    const selector = requiredStringParam(params, "selector");
    const session = this.restoreSessionBySelector(
      connection,
      context.user,
      context.clientId,
      cwd,
      selector,
    );
    return {
      session: this.sessionSummary(session),
      events: session.events,
    };
  }

  private executeCommand(
    connection: WebSocketConnection,
    params: unknown,
  ): SlashCommandResult {
    const execution = slashCommandExecution(params);
    const context = this.clientContext(connection, params);
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
      case "model":
        return {
          handled: true,
          action: "print",
          output: this.configureModel(execution),
        };
      case "effort":
        return {
          handled: true,
          action: "print",
          output: this.configureEffort(execution),
        };
      case "think":
        return {
          handled: true,
          action: "print",
          output: this.configureThink(execution),
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
          output: this.formatSessions(
            context.user,
            execution.cwd ?? this.options.cwd,
          ),
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
          context.user,
          context.clientId,
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
              context.user,
              execution.cwd ?? this.options.cwd,
              execution.sessionId,
            ),
          };
        }
        const deleted = this.deleteSessionBySelector(
          context.user,
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

  private async startTurn(
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
    const context = this.clientContext(connection, params);
    session.clientIds.add(context.clientId);
    session.subscribers.add(connection);
    this.ensureSessionPersisted(session, prompt);
    session.status = "running";
    session.updatedAt = Date.now();
    this.appendSessionRecord(session, {
      type: "turn_start_requested",
      sessionId: session.id,
      user: session.user,
      clientId: context.clientId,
      turnId,
      prompt,
      cwd,
      requestedAt: session.updatedAt,
    });
    await this.flushPersistence();
    setImmediate(() => {
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
    this.appendSessionRecord(session, {
      type: "runtime_event",
      sessionId: session.id,
      user: session.user,
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
    this.appendSessionRecord(session, {
      type: "notification",
      sessionId: session.id,
      user: session.user,
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
      this.appendSessionRecord(session, {
        type: "session_detached",
        sessionId: session.id,
        user: session.user,
        status: session.status,
        disconnectedAt: session.updatedAt,
      });
      void this.flushPersistence();
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
    user: string,
    clientId: string,
    cwd: string,
    selector: string,
  ): LiveSession {
    const session = this.resolveSessionSelector(user, cwd, selector);
    const live = this.sessions.get(session.id);
    if (live !== undefined) {
      if (connection !== undefined) {
        live.subscribers.add(connection);
      }
      live.clientIds.add(clientId);
      this.acquireOwnership(live);
      return live;
    }
    const persisted = this.readPersistedSession(session.id);
    if (persisted === undefined) {
      throw new Error(`unknown session: ${selector}`);
    }
    const config = this.configForPersistedSession(persisted);
    const runtime = new AgentRuntime({
      cwd: persisted.cwd,
      config,
      client: this.options.createClient(config),
      sessionId: persisted.id,
      history: conversationHistoryFromRuntimeEvents(persisted.events),
      sources: this.options.sources,
      bootstrap: this.bootstrap,
    });
    const liveSession: LiveSession = {
      id: persisted.id,
      user: persisted.user,
      clientIds: new Set([clientId]),
      logKey: persisted.logKey,
      cwd: persisted.cwd,
      config,
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
    this.appendSessionRecord(liveSession, {
      type: "session_restored",
      sessionId: liveSession.id,
      user: liveSession.user,
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
    user: string,
    cwd: string,
    selector: string,
  ): SessionListEntry {
    const sessions = this.numberedSessionsForCwd(user, cwd);
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
    user: string,
    cwd: string,
    selector: string,
    currentSessionId: string | undefined,
  ): SessionListEntry {
    const session = this.resolveSessionSelector(user, cwd, selector);
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
    this.store.deleteSession(session.id);
    return session;
  }

  private deletableSessionsForCwd(
    user: string,
    cwd: string,
    currentSessionId: string | undefined,
  ): SessionListEntry[] {
    return this.numberedSessionsForCwd(user, cwd).filter(
      (session) => session.id !== currentSessionId,
    );
  }

  private numberedSessionsForCwd(
    user: string,
    cwd: string,
  ): SessionListEntry[] {
    const normalizedCwd = resolve(cwd);
    const byId = new Map<string, Omit<SessionListEntry, "number">>();
    for (const persisted of this.readPersistedSessions()) {
      if (persisted.user !== user || resolve(persisted.cwd) !== normalizedCwd) {
        continue;
      }
      byId.set(persisted.id, {
        id: persisted.id,
        user: persisted.user,
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
      if (
        !session.persisted ||
        session.user !== user ||
        resolve(session.cwd) !== normalizedCwd
      ) {
        continue;
      }
      byId.set(session.id, {
        id: session.id,
        user: session.user,
        sequence:
          session.sequence ??
          this.nextSequenceForCwd(session.user, session.cwd),
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
      user: session.user,
      clientIds: [...session.clientIds],
      cwd: session.cwd,
      status: session.status,
      model: session.config.model,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      number: session.sequence,
      title: session.title,
    };
  }

  private configureModel(execution: SlashCommandExecution): string {
    const session = this.sessionForCommand(execution.sessionId);
    const args = (execution.args ?? "").trim().split(/\s+/).filter(Boolean);
    if (args.length === 0) {
      return this.formatModelStatus(session.config);
    }
    let index = 0;
    if (args[index] !== "effort" && args[index] !== "think") {
      this.switchSessionModel(
        session,
        this.resolveModelSelection(session.config, args[index]),
      );
      index += 1;
    }
    while (index < args.length) {
      const key = args[index];
      const value = args[index + 1];
      if (key === "effort") {
        if (value === undefined) {
          throw new Error("usage: /model effort <value>");
        }
        this.setEffort(session.config.activeModel, value);
        index += 2;
      } else if (key === "think") {
        if (value === undefined) {
          throw new Error("usage: /model think <on|off>");
        }
        this.setThink(session.config.activeModel, value);
        index += 2;
      } else {
        throw new Error(`unsupported /model option: ${key}`);
      }
    }
    session.updatedAt = Date.now();
    return this.formatModelStatus(session.config);
  }

  private configureEffort(execution: SlashCommandExecution): string {
    const session = this.sessionForCommand(execution.sessionId);
    const args = (execution.args ?? "").trim().split(/\s+/).filter(Boolean);
    const active = session.config.activeModel;
    if (active.effort === undefined || active.effort.length === 0) {
      return `model ${active.id ?? active.name} does not support effort`;
    }
    if (args.length === 0) {
      return this.formatEffortSelection(active);
    }
    this.setEffort(active, this.resolveEffortSelection(active, args[0]));
    session.updatedAt = Date.now();
    return this.formatEffortSelection(active);
  }

  private configureThink(execution: SlashCommandExecution): string {
    const session = this.sessionForCommand(execution.sessionId);
    const args = (execution.args ?? "").trim().split(/\s+/).filter(Boolean);
    const active = session.config.activeModel;
    if (active.think === undefined) {
      return `model ${active.id ?? active.name} does not support think`;
    }
    if (args.length === 0) {
      return this.formatThinkSelection(active);
    }
    this.setThink(active, this.resolveThinkSelection(args[0]));
    session.updatedAt = Date.now();
    return this.formatThinkSelection(active);
  }

  private sessionForCommand(sessionId: string | undefined): LiveSession {
    const session =
      sessionId === undefined ? undefined : this.sessions.get(sessionId);
    if (session === undefined) {
      throw new Error("sessionId is required for /model");
    }
    return session;
  }

  private switchSessionModel(session: LiveSession, model: string): void {
    const next = configForModel(session.config, model);
    session.config.model = next.model;
    session.config.activeModel = next.activeModel;
    session.config.activeProvider = next.activeProvider;
    session.config.activeModel.activeEffort = defaultModelEffort(
      session.config.activeModel,
    );
    session.config.activeModel.activeThink = defaultModelThink(
      session.config.activeModel,
    );
  }

  private setEffort(model: ModelSettings, effort: string): void {
    if (model.effort === undefined || model.effort.length === 0) {
      throw new Error(
        `model ${model.id ?? model.name} does not support effort`,
      );
    }
    if (!model.effort.includes(effort)) {
      throw new Error(
        `model ${model.id ?? model.name} effort must be one of: ${model.effort.join(", ")}`,
      );
    }
    model.activeEffort = effort;
  }

  private setThink(model: ModelSettings, value: string): void {
    if (model.think === undefined) {
      throw new Error(`model ${model.id ?? model.name} does not support think`);
    }
    if (value !== "on" && value !== "off") {
      throw new Error("think must be on or off");
    }
    model.activeThink = value === "on";
  }

  private resolveModelSelection(config: NdxConfig, selection: string): string {
    const number = Number.parseInt(selection, 10);
    if (Number.isInteger(number) && String(number) === selection) {
      const selected = config.modelPools.session[number - 1];
      if (selected === undefined) {
        throw new Error(
          `model number must be 1-${config.modelPools.session.length}`,
        );
      }
      return selected;
    }
    return selection;
  }

  private resolveEffortSelection(
    model: ModelSettings,
    selection: string,
  ): string {
    const number = Number.parseInt(selection, 10);
    if (Number.isInteger(number) && String(number) === selection) {
      const selected = model.effort?.[number - 1];
      if (selected === undefined) {
        throw new Error(`effort number must be 1-${model.effort?.length ?? 0}`);
      }
      return selected;
    }
    return selection;
  }

  private resolveThinkSelection(selection: string): string {
    if (selection === "1") {
      return "on";
    }
    if (selection === "2") {
      return "off";
    }
    return selection;
  }

  private formatEffortSelection(model: ModelSettings): string {
    const active = model.activeEffort ?? defaultModelEffort(model);
    const rows = (model.effort ?? []).map((effort, index) => {
      const current = effort === active ? "*" : " ";
      return `${index + 1}. ${current} ${effort}`;
    });
    return [
      `effort: ${active ?? "unsupported"}`,
      "choose effort:",
      ...rows,
    ].join("\n");
  }

  private formatThinkSelection(model: ModelSettings): string {
    const active = model.activeThink === false ? "off" : "on";
    return [
      `think: ${active}`,
      "choose think mode:",
      `1. ${active === "on" ? "*" : " "} on`,
      `2. ${active === "off" ? "*" : " "} off`,
    ].join("\n");
  }

  private formatModelStatus(config: NdxConfig): string {
    const active = config.activeModel;
    const sessionModels = new Set(config.modelPools.session);
    const rows = config.models.map((model) => {
      const id = model.id ?? model.name;
      const current = id === config.model ? "*" : " ";
      const number = config.modelPools.session.indexOf(id);
      const prefix = number === -1 ? " -" : `${number + 1}.`;
      const effort =
        model.effort === undefined
          ? "effort: unsupported"
          : `effort: ${model.activeEffort ?? "unset"} (${model.effort.join(", ")})`;
      const think =
        model.think === undefined
          ? "think: unsupported"
          : `think: ${model.activeThink === false ? "off" : "on"}`;
      const scope = sessionModels.has(id) ? "session" : "catalog";
      return `${prefix} ${current} ${id} -> ${model.name} [${effort}; ${think}; ${scope}]`;
    });
    return [
      `model: ${config.model} -> ${active.name}`,
      `provider: ${active.provider}`,
      `effort: ${active.activeEffort ?? "unsupported"}`,
      `think: ${active.think === undefined ? "unsupported" : active.activeThink === false ? "off" : "on"}`,
      "",
      "usage: /model <number|id> [effort <value|number>] [think <on|off|1|2>]",
      "       /model effort <value>",
      "       /model think <on|off>",
      "",
      "models:",
      ...rows,
    ].join("\n");
  }

  private formatCommandStatus(sessionId: string | undefined): string {
    const session =
      sessionId === undefined ? undefined : this.sessions.get(sessionId);
    const sessionLine =
      session === undefined
        ? "session: not started"
        : `session: ${session.sequence ?? "empty"} ${session.id} (${session.status})`;
    const modelLine =
      session === undefined
        ? undefined
        : `model: ${session.config.model} (${session.config.activeModel.name})`;
    const effortLine =
      session === undefined
        ? undefined
        : `effort: ${session.config.activeModel.activeEffort ?? "unsupported"}`;
    const thinkLine =
      session === undefined
        ? undefined
        : `think: ${session.config.activeModel.think === undefined ? "unsupported" : session.config.activeModel.activeThink === false ? "off" : "on"}`;
    return [
      "server: ndx-ts-session-server",
      sessionLine,
      modelLine,
      effortLine,
      thinkLine,
    ]
      .filter((line) => line !== undefined)
      .join("\n");
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

  private formatSessions(user: string, cwd: string): string {
    const sessions = this.numberedSessionsForCwd(user, cwd);
    if (sessions.length === 0) {
      return [`sessions for ${user} ${resolve(cwd)}`, "0. new session"].join(
        "\n",
      );
    }
    return [
      `sessions for ${user} ${resolve(cwd)}`,
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
    user: string,
    cwd: string,
    currentSessionId: string | undefined,
  ): string {
    const sessions = this.deletableSessionsForCwd(user, cwd, currentSessionId);
    if (sessions.length === 0) {
      return [
        `delete sessions for ${user} ${resolve(cwd)}`,
        "no deletable sessions",
      ].join("\n");
    }
    return [
      `delete sessions for ${user} ${resolve(cwd)}`,
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
    return this.store.readSessions().map(storedSessionToPersisted);
  }

  private readPersistedSession(
    sessionId: string,
  ): PersistedSessionState | undefined {
    const stored = this.store.readSession(sessionId);
    return stored === undefined ? undefined : storedSessionToPersisted(stored);
  }

  private ensureSessionPersisted(session: LiveSession, prompt: string): void {
    if (session.persisted) {
      return;
    }
    const now = Date.now();
    const title = titleFromPrompt(prompt);
    const sequence = this.store.createSession({
      id: session.id,
      user: session.user,
      cwd: session.cwd,
      title,
      status: session.status,
      model: session.config.model,
      createdAt: now,
    });
    session.sequence = sequence;
    session.title = title;
    session.createdAt = now;
    session.updatedAt = now;
    session.logKey = session.id;
    session.persisted = true;
    this.acquireOwnership(session);
  }

  private nextSequenceForCwd(user: string, cwd: string): number {
    const normalizedCwd = resolve(cwd);
    const maxSequence = this.readPersistedSessions()
      .filter(
        (session) =>
          session.user === user && resolve(session.cwd) === normalizedCwd,
      )
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
    if (!this.store.sessionExists(session.id)) {
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
    const config = this.configForPersistedSession(persisted);
    const reloaded: LiveSession = {
      id: persisted.id,
      user: persisted.user,
      clientIds: session.clientIds,
      logKey: persisted.logKey,
      cwd: persisted.cwd,
      config,
      runtime: new AgentRuntime({
        cwd: persisted.cwd,
        config,
        client: this.options.createClient(config),
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
    this.store.claimOwner(session.id, this.serverId);
  }

  private currentOwner(sessionId: string): string | undefined {
    return this.store.currentOwner(sessionId);
  }

  private dataDir(): string {
    return (
      this.options.dataDir ??
      this.options.persistenceDir ??
      this.options.config.paths.dataDir ??
      this.options.config.paths.sessionDir ??
      "/home/.ndx/system"
    );
  }

  private appendSessionRecord(
    session: LiveSession,
    record: Record<string, unknown>,
  ): void {
    if (!session.persisted || this.closing) {
      return;
    }
    this.store.appendRecord(
      session.id,
      typeof record.type === "string" ? record.type : "record",
      record,
    );
  }

  private terminateIfDeleted(session: LiveSession, message: string): boolean {
    if (!session.persisted || this.store.sessionExists(session.id)) {
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
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function isPublicMethod(method: string | undefined): boolean {
  return (
    method === "account/create" ||
    method === "account/login" ||
    method === "account/socialLogin"
  );
}

async function verifiedSocialProfile(
  provider: string,
  accessToken: string,
): Promise<{ subject: string; email?: string; displayName?: string }> {
  if (provider === "github") {
    const profile = await fetchJsonWithBearer(
      "https://api.github.com/user",
      accessToken,
    );
    return {
      subject: String(requiredProfileField(profile, "id")),
      email: optionalProfileString(profile, "email"),
      displayName:
        optionalProfileString(profile, "login") ??
        optionalProfileString(profile, "name"),
    };
  }
  if (provider === "google") {
    const profile = await fetchJsonWithBearer(
      "https://openidconnect.googleapis.com/v1/userinfo",
      accessToken,
    );
    return {
      subject: String(requiredProfileField(profile, "sub")),
      email: optionalProfileString(profile, "email"),
      displayName: optionalProfileString(profile, "name"),
    };
  }
  throw new Error(`unsupported social login provider: ${provider}`);
}

async function fetchJsonWithBearer(
  url: string,
  token: string,
): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "authorization": `Bearer ${token}`,
      "user-agent": "ndx-session-server",
    },
  });
  if (!response.ok) {
    throw new Error(`social login profile request failed: ${response.status}`);
  }
  return response.json();
}

function requiredProfileField(profile: unknown, field: string): unknown {
  if (profile === null || typeof profile !== "object" || !(field in profile)) {
    throw new Error(`social login profile missing ${field}`);
  }
  return (profile as Record<string, unknown>)[field];
}

function optionalProfileString(
  profile: unknown,
  field: string,
): string | undefined {
  if (profile === null || typeof profile !== "object" || !(field in profile)) {
    return undefined;
  }
  const value = (profile as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

function listenHttp(
  server: Server,
  port: number,
  host: string,
  label: string,
): Promise<{ port: number }> {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error(`${label} did not bind a TCP address`));
        return;
      }
      resolveListen({ port: address.port });
    });
  });
}

function storedSessionToPersisted(
  session: StoredSession,
): PersistedSessionState {
  return {
    id: session.id,
    user: session.user,
    logKey: session.id,
    cwd: session.cwd,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    events: session.events,
    sequence: session.sequence,
    title: session.title,
  };
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return sanitized.length === 0 ? "defaultUser" : sanitized;
}

function userFromLogKey(logKey: string): string {
  return logKey.split("/")[0] || "defaultUser";
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ndx Agent Service</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: Canvas;
        color: CanvasText;
      }
      main {
        width: min(720px, calc(100vw - 48px));
      }
      h1 {
        margin: 0 0 12px;
        font-size: 32px;
        font-weight: 650;
      }
      p {
        margin: 0;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main aria-labelledby="dashboard-title" data-testid="agent-dashboard-placeholder">
      <h1 id="dashboard-title">ndx Agent Service</h1>
      <p role="status">Dashboard placeholder is running.</p>
    </main>
  </body>
</html>`;

function sleepSync(ms: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, ms);
}

class WebSocketConnection {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  user = "defaultUser";
  clientId: string = randomUUID();
  authenticated = false;

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

  destroy(): void {
    this.socket.destroy();
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
