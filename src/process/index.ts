import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

export interface ProcessRunOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ProcessRunResult {
  command: string;
  args: string[];
  cwd: string;
  pid?: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}

export interface QueueTaskContext {
  signal: AbortSignal;
  onCancel: (hook: () => void | Promise<void>) => void;
}

export interface QueueTask<T = unknown> {
  id?: string;
  name?: string;
  run: (context: QueueTaskContext) => Promise<T>;
}

export type QueuePlan<T = unknown> =
  | QueueTask<T>
  | { serial: QueuePlan<T>[] }
  | { parallel: QueuePlan<T>[] };

export interface QueueTaskResult<T = unknown> {
  id: string;
  name?: string;
  status: "completed" | "cancelled" | "failed";
  value?: T;
  error?: unknown;
}

export class TaskQueue {
  private readonly controllers = new Map<string, AbortController>();
  private readonly cancelHooks = new Map<
    string,
    Array<() => void | Promise<void>>
  >();

  async run<T>(
    plan: QueuePlan<T>,
    signal?: AbortSignal,
  ): Promise<QueueTaskResult<T>[]> {
    const controller = new AbortController();
    const relayAbort = (): void => {
      controller.abort(signal?.reason);
    };
    signal?.addEventListener("abort", relayAbort, { once: true });
    try {
      return await this.runPlan(plan, controller.signal);
    } finally {
      signal?.removeEventListener("abort", relayAbort);
    }
  }

  async cancelAll(reason = "queue cancelled"): Promise<void> {
    const ids = [...this.controllers.keys()];
    await Promise.all(ids.map((id) => this.cancel(id, reason)));
  }

  async cancel(id: string, reason = "task cancelled"): Promise<void> {
    this.controllers.get(id)?.abort(reason);
    const hooks = this.cancelHooks.get(id) ?? [];
    await Promise.all(hooks.map((hook) => hook()));
  }

  private async runPlan<T>(
    plan: QueuePlan<T>,
    signal: AbortSignal,
  ): Promise<QueueTaskResult<T>[]> {
    if ("serial" in plan) {
      const results: QueueTaskResult<T>[] = [];
      for (const child of plan.serial) {
        if (signal.aborted) {
          break;
        }
        results.push(...(await this.runPlan(child, signal)));
      }
      return results;
    }
    if ("parallel" in plan) {
      const batches = await Promise.all(
        plan.parallel.map((child) => this.runPlan(child, signal)),
      );
      return batches.flat();
    }
    return [await this.runTask(plan, signal)];
  }

  private async runTask<T>(
    task: QueueTask<T>,
    parentSignal: AbortSignal,
  ): Promise<QueueTaskResult<T>> {
    const id = task.id ?? randomUUID();
    const controller = new AbortController();
    const relayAbort = (): void => {
      controller.abort(parentSignal.reason);
    };
    parentSignal.addEventListener("abort", relayAbort, { once: true });
    this.controllers.set(id, controller);
    this.cancelHooks.set(id, []);
    try {
      const value = await task.run({
        signal: controller.signal,
        onCancel: (hook) => {
          this.cancelHooks.get(id)?.push(hook);
        },
      });
      return { id, name: task.name, status: "completed", value };
    } catch (error) {
      return {
        id,
        name: task.name,
        status: controller.signal.aborted ? "cancelled" : "failed",
        error,
      };
    } finally {
      parentSignal.removeEventListener("abort", relayAbort);
      this.controllers.delete(id);
      this.cancelHooks.delete(id);
    }
  }
}

export async function runProcess(
  options: ProcessRunOptions,
): Promise<ProcessRunResult> {
  const args = options.args ?? [];
  const cwd = resolve(options.cwd ?? process.cwd());
  return await new Promise<ProcessRunResult>((resolveResult, reject) => {
    const child = spawn(options.command, args, {
      cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    const cleanup = processCleanup(child, options.signal, () => {
      cancelled = true;
    });
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, options.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      cleanup();
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      reject(error);
    });
    child.on("close", (exitCode) => {
      cleanup();
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resolveResult({
        command: options.command,
        args,
        cwd,
        pid: child.pid,
        exitCode,
        stdout,
        stderr,
        timedOut,
        cancelled,
      });
    });
    child.stdin.end(options.input ?? "");
  });
}

function processCleanup(
  child: ChildProcess,
  signal: AbortSignal | undefined,
  onCancel: () => void,
): () => void {
  if (signal === undefined) {
    return () => {};
  }
  const abort = (): void => {
    onCancel();
    child.kill("SIGTERM");
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) {
    queueMicrotask(abort);
  }
  return () => {
    signal.removeEventListener("abort", abort);
  };
}
