import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Socket } from "node:net";
import { join } from "node:path";
import { AgentRuntime } from "./runtime.js";
import type { RuntimeEvent, RuntimeEventMsg } from "./protocol.js";
import type { ModelClient, NdxConfig } from "./types.js";

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
  createClient: () => ModelClient;
  persistenceDir?: string;
}

/** Concrete loopback address chosen by the session server listener. */
export interface SessionServerAddress {
  host: string;
  port: number;
  url: string;
}

interface ServerThread {
  id: string;
  cwd: string;
  runtime: AgentRuntime;
  events: RuntimeEvent[];
  subscribers: Set<WebSocketConnection>;
  status: "idle" | "running" | "aborted" | "failed";
  createdAt: number;
  updatedAt: number;
}

/** WebSocket JSON-RPC authority for live threads, event fan-out, and JSONL. */
export class SessionServer {
  private readonly server: Server;
  private readonly options: SessionServerOptions;
  private readonly threads = new Map<string, ServerThread>();
  private readonly clients = new Set<WebSocketConnection>();
  private readonly store: SessionLogStore;

  constructor(options: SessionServerOptions) {
    this.options = options;
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
    await this.flushPersistence();
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
      this.clients.delete(connection);
      for (const thread of this.threads.values()) {
        thread.subscribers.delete(connection);
      }
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
          methods: [
            "initialize",
            "thread/start",
            "thread/subscribe",
            "thread/read",
            "turn/start",
            "turn/interrupt",
          ],
        };
      case "thread/start":
        return this.startThread(connection, request.params);
      case "thread/subscribe":
        return this.subscribeThread(connection, request.params);
      case "thread/read":
        return this.readThread(request.params);
      case "turn/start":
        return this.startTurn(connection, request.params);
      case "turn/interrupt":
        return this.interruptTurn(request.params);
      default:
        throw new Error(`unsupported session method: ${request.method}`);
    }
  }

  private async startThread(
    connection: WebSocketConnection,
    params: unknown,
  ): Promise<unknown> {
    const cwd = stringParam(params, "cwd") ?? this.options.cwd;
    const runtime = new AgentRuntime({
      cwd,
      config: this.options.config,
      client: this.options.createClient(),
      sources: this.options.sources,
    });
    const now = Date.now();
    const thread: ServerThread = {
      id: runtime.sessionId,
      cwd,
      runtime,
      events: [],
      subscribers: new Set([connection]),
      status: "idle",
      createdAt: now,
      updatedAt: now,
    };
    this.threads.set(thread.id, thread);
    await this.store.append(thread.id, {
      type: "thread_started",
      threadId: thread.id,
      cwd,
      createdAt: now,
    });
    this.publish(thread, {
      method: "thread/started",
      params: this.threadSummary(thread),
    });
    return { thread: this.threadSummary(thread) };
  }

  private async subscribeThread(
    connection: WebSocketConnection,
    params: unknown,
  ): Promise<unknown> {
    const thread = this.requiredThread(params);
    thread.subscribers.add(connection);
    await this.store.append(thread.id, {
      type: "thread_subscribed",
      threadId: thread.id,
      subscribedAt: Date.now(),
    });
    return { thread: this.threadSummary(thread), events: thread.events };
  }

  private readThread(params: unknown): unknown {
    const thread = this.requiredThread(params);
    return { thread: this.threadSummary(thread), events: thread.events };
  }

  private startTurn(
    connection: WebSocketConnection,
    params: unknown,
  ): Promise<unknown> {
    const thread = this.requiredThread(params);
    const prompt = requiredStringParam(params, "prompt");
    const cwd = stringParam(params, "cwd") ?? thread.cwd;
    const turnId = randomUUID();
    thread.subscribers.add(connection);
    thread.status = "running";
    thread.updatedAt = Date.now();
    void this.store.append(thread.id, {
      type: "turn_start_requested",
      threadId: thread.id,
      turnId,
      prompt,
      cwd,
      requestedAt: thread.updatedAt,
    });
    void thread.runtime
      .submit(
        {
          id: turnId,
          op: { type: "user_turn", prompt, cwd },
        },
        (event) => this.handleRuntimeEvent(thread, event),
      )
      .catch((error: unknown) => {
        thread.status = "failed";
        thread.updatedAt = Date.now();
        this.publish(thread, {
          method: "error",
          params: {
            threadId: thread.id,
            turnId,
            message: errorMessage(error),
          },
        });
      });
    return Promise.resolve({ turn: { id: turnId, status: "in_progress" } });
  }

  private interruptTurn(params: unknown): Promise<unknown> {
    const thread = this.requiredThread(params);
    const reason = stringParam(params, "reason") ?? "interrupted";
    thread.runtime.interrupt(reason, (event) =>
      this.handleRuntimeEvent(thread, event),
    );
    return Promise.resolve({ thread: this.threadSummary(thread) });
  }

  private handleRuntimeEvent(thread: ServerThread, event: RuntimeEvent): void {
    thread.events.push(event);
    thread.updatedAt = Date.now();
    const msg = event.msg;
    if (msg.type === "turn_complete") {
      thread.status = "idle";
    } else if (msg.type === "turn_aborted") {
      thread.status = "aborted";
    } else if (msg.type === "error") {
      thread.status = "failed";
    }
    void this.store.append(thread.id, {
      type: "runtime_event",
      threadId: thread.id,
      event,
      recordedAt: thread.updatedAt,
    });
    this.publish(thread, runtimeNotification(thread.id, msg));
  }

  private publish(
    thread: ServerThread,
    notification: JsonRpcNotification,
  ): void {
    void this.store.append(thread.id, {
      type: "notification",
      threadId: thread.id,
      notification,
      recordedAt: Date.now(),
    });
    for (const subscriber of thread.subscribers) {
      subscriber.sendJson(notification);
    }
  }

  private requiredThread(params: unknown): ServerThread {
    const threadId = requiredStringParam(params, "threadId");
    const thread = this.threads.get(threadId);
    if (thread === undefined) {
      throw new Error(`unknown thread: ${threadId}`);
    }
    return thread;
  }

  private threadSummary(thread: ServerThread): unknown {
    return {
      id: thread.id,
      cwd: thread.cwd,
      status: thread.status,
      model: this.options.config.model,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    };
  }
}

class SessionLogStore {
  private queue = Promise.resolve();
  private disabledReason: string | undefined;

  constructor(private readonly dir: string) {}

  append(threadId: string, record: Record<string, unknown>): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (this.disabledReason !== undefined) {
        return;
      }
      try {
        await mkdir(this.dir, { recursive: true });
        await appendFile(
          join(this.dir, `${threadId}.jsonl`),
          `${JSON.stringify({ ...record, persistedAt: Date.now() })}\n`,
        );
      } catch (error) {
        this.disabledReason = errorMessage(error);
        console.error(
          `[session-server] persistence disabled for ${this.dir}: ${this.disabledReason}`,
        );
      }
    });
    return this.queue;
  }

  async flush(): Promise<void> {
    await this.queue;
  }
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
  threadId: string,
  msg: RuntimeEventMsg,
): JsonRpcNotification {
  const params = { threadId, event: msg };
  switch (msg.type) {
    case "session_configured":
      return { method: "thread/sessionConfigured", params };
    case "turn_started":
      return { method: "turn/started", params };
    case "agent_message":
      return { method: "item/agentMessage", params };
    case "tool_call":
      return { method: "item/toolCall", params };
    case "tool_result":
      return { method: "item/toolResult", params };
    case "token_count":
      return { method: "thread/tokenUsage/updated", params };
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

function requiredStringParam(params: unknown, name: string): string {
  const value = stringParam(params, name);
  if (value === undefined) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function stringParam(params: unknown, name: string): string | undefined {
  if (params === null || typeof params !== "object") {
    return undefined;
  }
  const value = (params as Record<string, unknown>)[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function rpcError(code: number, message: string, data?: unknown): JsonRpcError {
  return { code, message, data: data instanceof Error ? data.message : data };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
