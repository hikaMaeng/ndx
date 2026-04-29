import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export type SessionLogRecord = Record<string, unknown>;

interface QueuedWrite {
  id: string;
  threadId: string;
  record: SessionLogRecord;
  attempts: number;
}

interface WriterMessage {
  type: "write_result";
  jobId: string;
  ok: boolean;
  error?: string;
}

const MAX_WRITE_ATTEMPTS = 3;

/** Async queue that persists session log records through a child process. */
export class SessionLogStore {
  private readonly queue: QueuedWrite[] = [];
  private readonly flushWaiters: Array<() => void> = [];
  private worker: ChildProcess | undefined;
  private inFlight: QueuedWrite | undefined;
  private closing = false;

  constructor(private readonly dir: string) {}

  append(threadId: string, record: SessionLogRecord): void {
    if (this.closing) {
      return;
    }
    this.queue.push({
      id: randomUUID(),
      threadId,
      record,
      attempts: 0,
    });
    this.pump();
  }

  flush(): Promise<void> {
    if (this.isIdle()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.flushWaiters.push(resolve);
      this.pump();
    });
  }

  async close(): Promise<void> {
    await this.flush();
    this.closing = true;
    this.stopWorker();
  }

  private pump(): void {
    if (this.inFlight !== undefined || this.queue.length === 0) {
      this.resolveFlushWaitersIfIdle();
      return;
    }
    const worker = this.ensureWorker();
    const next = this.queue.shift();
    if (next === undefined) {
      this.resolveFlushWaitersIfIdle();
      return;
    }
    next.attempts += 1;
    this.inFlight = next;
    worker.send({
      type: "write",
      job: {
        id: next.id,
        dir: this.dir,
        threadId: next.threadId,
        record: next.record,
      },
    });
  }

  private ensureWorker(): ChildProcess {
    if (this.worker !== undefined && !this.worker.killed) {
      return this.worker;
    }
    const worker = fork(
      fileURLToPath(new URL("./log-writer.js", import.meta.url)),
      [],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    worker.stderr?.setEncoding("utf8");
    worker.stderr?.on("data", (chunk) => {
      console.error(`[session-log-writer] ${String(chunk).trimEnd()}`);
    });
    worker.on("message", (message) => this.handleWorkerMessage(message));
    worker.on("error", (error) => this.handleWorkerFailure(error));
    worker.on("exit", (code, signal) => {
      this.handleWorkerFailure(
        new Error(`session log worker exited code=${code} signal=${signal}`),
      );
    });
    this.worker = worker;
    return worker;
  }

  private handleWorkerMessage(message: unknown): void {
    if (!isWriterMessage(message) || this.inFlight?.id !== message.jobId) {
      return;
    }
    const job = this.inFlight;
    this.inFlight = undefined;
    if (!message.ok) {
      this.retryOrDrop(job, message.error ?? "unknown persistence error");
    }
    if (this.queue.length === 0) {
      this.stopWorker();
    }
    this.resolveFlushWaitersIfIdle();
    this.pump();
  }

  private handleWorkerFailure(error: Error): void {
    const failed = this.inFlight;
    this.inFlight = undefined;
    this.worker = undefined;
    if (failed !== undefined) {
      this.retryOrDrop(failed, error.message);
    } else {
      console.error(`[session-log-store] ${error.message}`);
    }
    this.resolveFlushWaitersIfIdle();
    this.pump();
  }

  private retryOrDrop(job: QueuedWrite, reason: string): void {
    if (job.attempts < MAX_WRITE_ATTEMPTS) {
      this.queue.unshift(job);
      return;
    }
    console.error(
      `[session-log-store] dropped persistence job ${job.id} after ${job.attempts} attempts: ${reason}`,
    );
  }

  private stopWorker(): void {
    const worker = this.worker;
    this.worker = undefined;
    if (worker !== undefined && worker.connected) {
      worker.removeAllListeners("message");
      worker.removeAllListeners("error");
      worker.removeAllListeners("exit");
      worker.disconnect();
    }
  }

  private isIdle(): boolean {
    return this.queue.length === 0 && this.inFlight === undefined;
  }

  private resolveFlushWaitersIfIdle(): void {
    if (!this.isIdle()) {
      return;
    }
    const waiters = this.flushWaiters.splice(0);
    for (const resolve of waiters) {
      resolve();
    }
  }
}

function isWriterMessage(message: unknown): message is WriterMessage {
  if (message === null || typeof message !== "object") {
    return false;
  }
  const value = message as Record<string, unknown>;
  return (
    value.type === "write_result" &&
    typeof value.jobId === "string" &&
    typeof value.ok === "boolean"
  );
}
