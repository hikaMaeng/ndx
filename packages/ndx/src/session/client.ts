export type JsonRpcId = number | string;

/** WebSocket notification emitted by the ndx session server. */
export interface SessionNotification {
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: { data?: unknown; error?: unknown }) => void,
    options?: { once?: boolean },
  ): void;
}

type WebSocketConstructor = new (url: string) => WebSocketLike;
type NotificationHandler = (notification: SessionNotification) => void;

/** JSON-RPC WebSocket client used by CLI-style ndx frontends. */
export class SessionClient {
  private readonly ws: WebSocketLike;
  private nextId = 1;
  private readonly pending = new Map<
    JsonRpcId,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly notificationHandlers = new Set<NotificationHandler>();

  private constructor(ws: WebSocketLike) {
    this.ws = ws;
    ws.addEventListener("message", (event) => this.handleMessage(event.data));
    ws.addEventListener("close", () =>
      this.rejectPending(new Error("session server connection closed")),
    );
    ws.addEventListener("error", (event) =>
      this.rejectPending(
        event.error instanceof Error
          ? event.error
          : new Error("WebSocket error"),
      ),
    );
  }

  static connect(url: string): Promise<SessionClient> {
    const ctor = (globalThis as unknown as { WebSocket?: WebSocketConstructor })
      .WebSocket;
    if (ctor === undefined) {
      throw new Error(
        "global WebSocket is unavailable; Node.js 22+ is required",
      );
    }
    const ws = new ctor(url);
    return new Promise((resolve, reject) => {
      ws.addEventListener(
        "open",
        () => {
          resolve(new SessionClient(ws));
        },
        { once: true },
      );
      ws.addEventListener(
        "error",
        (event) => {
          reject(
            event.error instanceof Error
              ? event.error
              : new Error("WebSocket connection failed"),
          );
        },
        { once: true },
      );
    });
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId;
    this.nextId += 1;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    const response = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
    });
    this.ws.send(JSON.stringify(request));
    return response;
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => {
      this.notificationHandlers.delete(handler);
    };
  }

  close(): void {
    this.ws.close();
  }

  private handleMessage(data: unknown): void {
    const text =
      typeof data === "string"
        ? data
        : data instanceof ArrayBuffer
          ? Buffer.from(data).toString("utf8")
          : Buffer.isBuffer(data)
            ? data.toString("utf8")
            : String(data);
    const message = JSON.parse(text) as JsonRpcResponse | SessionNotification;
    if ("id" in message) {
      const pending = this.pending.get(message.id);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error !== undefined) {
        pending.reject(new Error(message.error.message));
        return;
      }
      pending.resolve(message.result);
      return;
    }
    for (const handler of this.notificationHandlers) {
      handler(message);
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
