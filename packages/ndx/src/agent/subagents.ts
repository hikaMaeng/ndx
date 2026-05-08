import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ModelConversationItem } from "../model/types.js";
import type { ModelClient, NdxConfig } from "../shared/types.js";
import type {
  CollaborationAgentController,
  CollaborationAgentSnapshot,
  CollaborationAgentStatus,
} from "../tools/collaboration/controller.js";
import type { ToolArguments, ToolContext } from "../tools/types.js";
import type { AgentRunOptions } from "./loop/types.js";

interface SubAgentControllerOptions {
  cwd: string;
  config: NdxConfig;
  client: ModelClient;
  runAgent: (options: AgentRunOptions) => Promise<string>;
}

interface AgentRecord extends CollaborationAgentSnapshot {
  controller: AbortController;
  history: ModelConversationItem[];
  promise?: Promise<void>;
}

interface JobRecord {
  id: string;
  createdAt: number;
  results: Record<string, unknown>;
}

export function createSubAgentController(
  options: SubAgentControllerOptions,
): CollaborationAgentController {
  return new SubAgentController(options);
}

class SubAgentController implements CollaborationAgentController {
  private readonly agents = new Map<string, AgentRecord>();
  private readonly jobs = new Map<string, JobRecord>();

  constructor(private readonly options: SubAgentControllerOptions) {}

  async spawnAgent(
    args: ToolArguments,
    context: ToolContext,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const prompt = promptFromArgs(args);
    if (prompt.length === 0) {
      throw new Error("spawn_agent requires message or items");
    }
    const id = randomUUID();
    const record: AgentRecord = {
      id,
      status: "running",
      agentType: optionalString(args.agent_type),
      prompt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastTaskMessage: prompt,
      controller: new AbortController(),
      history:
        args.fork_context === true ? [...(context.historySnapshot ?? [])] : [],
    };
    this.agents.set(id, record);
    this.startRun(record, prompt, context, signal);
    return this.spawnOutput(record);
  }

  async sendInput(
    args: ToolArguments,
    context: ToolContext,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const record = this.requireAgent(targetId(args));
    const prompt = promptFromArgs(args);
    if (prompt.length === 0) {
      throw new Error("send_input requires message or items");
    }
    record.lastTaskMessage = prompt;
    record.updatedAt = Date.now();
    if (record.status === "running") {
      return { status: "queued", agent: this.snapshot(record) };
    }
    if (record.status === "closed") {
      return { status: "closed", agent: this.snapshot(record) };
    }
    record.status = "running";
    record.controller = new AbortController();
    this.startRun(record, prompt, context, signal);
    return { status: "running", agent: this.snapshot(record) };
  }

  async resumeAgent(
    args: ToolArguments,
    _context: ToolContext,
  ): Promise<Record<string, unknown>> {
    const record = this.requireAgent(requiredString(args.id, "id"));
    if (record.status === "closed") {
      record.status = "completed";
      record.updatedAt = Date.now();
    }
    return { status: record.status, agent: this.snapshot(record) };
  }

  async waitAgent(
    args: ToolArguments,
    _context: ToolContext,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const targets = targetIds(args);
    const timeoutMs = optionalInteger(args.timeout_ms) ?? 30_000;
    const deadline = Date.now() + Math.max(0, timeoutMs);
    const pending = targets
      .map((id) => this.agents.get(id))
      .filter((record): record is AgentRecord => record !== undefined)
      .filter((record) => record.promise !== undefined)
      .map((record) => record.promise as Promise<void>);
    if (pending.length > 0 && timeoutMs > 0) {
      await Promise.race([
        Promise.allSettled(pending),
        sleepUntil(deadline, signal),
      ]);
    }
    return {
      status: "ok",
      agents: targets.map((id) =>
        this.agents.has(id)
          ? this.snapshot(this.agents.get(id) as AgentRecord)
          : { id, status: "not_found" satisfies CollaborationAgentStatus },
      ),
    };
  }

  async closeAgent(args: ToolArguments): Promise<Record<string, unknown>> {
    const record = this.requireAgent(requiredString(args.target, "target"));
    record.controller.abort("closed by close_agent");
    record.status = "closed";
    record.updatedAt = Date.now();
    return { status: "closed", agent: this.snapshot(record) };
  }

  async listAgents(args: ToolArguments): Promise<Record<string, unknown>> {
    const prefix = optionalString(args.path_prefix);
    const agents = [...this.agents.values()]
      .filter((record) => prefix === undefined || record.id.startsWith(prefix))
      .map((record) => this.snapshot(record));
    return { status: "ok", agents };
  }

  async spawnAgentsOnCsv(
    args: ToolArguments,
    context: ToolContext,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const csvPath = requiredString(args.csv_path, "csv_path");
    const template = requiredString(args.instruction, "instruction");
    const rows = parseCsv(readFileSync(csvPath, "utf8"));
    const jobId = randomUUID();
    this.jobs.set(jobId, { id: jobId, createdAt: Date.now(), results: {} });
    const agents = [];
    for (const [index, row] of rows.entries()) {
      const itemId =
        optionalString(row[optionalString(args.id_column) ?? ""]) ??
        String(index + 1);
      const message = renderTemplate(template, row);
      const result = await this.spawnAgent(
        {
          message,
          agent_type: "csv-worker",
          fork_context: false,
        },
        context,
        signal,
      );
      agents.push({ itemId, ...(result.agent as Record<string, unknown>) });
    }
    return { status: "started", job_id: jobId, agents };
  }

  async reportAgentJobResult(
    args: ToolArguments,
  ): Promise<Record<string, unknown>> {
    const jobId = requiredString(args.job_id, "job_id");
    const itemId = requiredString(args.item_id, "item_id");
    const job = this.jobs.get(jobId);
    if (job === undefined) {
      return { status: "not_found", job_id: jobId };
    }
    job.results[itemId] = args.result;
    return {
      status: args.stop === true ? "stopped" : "recorded",
      job_id: jobId,
      item_id: itemId,
    };
  }

  private startRun(
    record: AgentRecord,
    prompt: string,
    context: ToolContext,
    parentSignal?: AbortSignal,
  ): void {
    const abortParent = (): void => record.controller.abort("parent aborted");
    parentSignal?.addEventListener("abort", abortParent, { once: true });
    record.promise = this.options
      .runAgent({
        cwd: context.cwd || this.options.cwd,
        config: context.config || this.options.config,
        client: this.options.client,
        prompt,
        history: record.history,
        signal: record.controller.signal,
        agentController: this,
      })
      .then((finalText) => {
        if (record.status !== "closed") {
          record.status = "completed";
          record.finalText = finalText;
          record.history.push({
            type: "message",
            role: "assistant",
            content: finalText,
          });
        }
      })
      .catch((error: unknown) => {
        if (record.status !== "closed") {
          record.status = "failed";
          record.error = error instanceof Error ? error.message : String(error);
        }
      })
      .finally(() => {
        parentSignal?.removeEventListener("abort", abortParent);
        record.updatedAt = Date.now();
      });
  }

  private requireAgent(id: string): AgentRecord {
    const record = this.agents.get(id);
    if (record === undefined) {
      throw new Error(`unknown agent: ${id}`);
    }
    return record;
  }

  private spawnOutput(record: AgentRecord): Record<string, unknown> {
    return {
      status: record.status,
      agent_id: record.id,
      agent: this.snapshot(record),
    };
  }

  private snapshot(record: AgentRecord): CollaborationAgentSnapshot {
    return {
      id: record.id,
      status: record.status,
      agentType: record.agentType,
      prompt: record.prompt,
      finalText: record.finalText,
      error: record.error,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastTaskMessage: record.lastTaskMessage,
    };
  }
}

function promptFromArgs(args: ToolArguments): string {
  const parts = [];
  const message = optionalString(args.message);
  if (message !== undefined) {
    parts.push(message);
  }
  if (Array.isArray(args.items)) {
    parts.push(...args.items.map(renderInputItem));
  }
  return parts.filter((part) => part.length > 0).join("\n\n");
}

function renderInputItem(item: unknown): string {
  if (typeof item !== "object" || item === null) {
    return "";
  }
  const entry = item as { type?: unknown; text?: unknown; path?: unknown };
  if (typeof entry.text === "string") {
    return entry.text;
  }
  if (typeof entry.path === "string") {
    return `[${String(entry.type ?? "item")}](${entry.path})`;
  }
  return "";
}

function targetId(args: ToolArguments): string {
  return requiredString(args.target, "target");
}

function targetIds(args: ToolArguments): string[] {
  if (Array.isArray(args.targets)) {
    return args.targets.filter(
      (target): target is string => typeof target === "string",
    );
  }
  return [targetId(args)];
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalInteger(value: unknown): number | undefined {
  return Number.isInteger(value) ? (value as number) : undefined;
}

async function sleepUntil(
  deadline: number,
  signal?: AbortSignal,
): Promise<void> {
  const delay = Math.max(0, deadline - Date.now());
  await new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, delay);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = splitCsvLine(lines.shift() ?? "");
  return lines.map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    );
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function renderTemplate(template: string, row: Record<string, string>): string {
  return template.replaceAll(
    /\{([^}]+)\}/g,
    (_match, key: string) => row[key] ?? "",
  );
}
