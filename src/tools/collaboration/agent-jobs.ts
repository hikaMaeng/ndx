import {
  booleanSchema,
  functionTool,
  integerSchema,
  objectSchema,
  stringSchema,
} from "../schema.js";
import type { ToolDefinition } from "../types.js";

export function agentJobTools(): ToolDefinition[] {
  return [
    placeholder(
      "spawn_agents_on_csv",
      "Process a CSV by spawning one worker sub-agent per row. The instruction string is a template where {column} placeholders are replaced with row values.",
      {
        csv_path: stringSchema("Path to the CSV file containing input rows."),
        instruction: stringSchema(
          "Instruction template to apply to each CSV row.",
        ),
        id_column: stringSchema(
          "Optional column name to use as stable item id.",
        ),
        output_csv_path: stringSchema(
          "Optional output CSV path for exported results.",
        ),
        max_concurrency: integerSchema(
          "Maximum concurrent workers for this job.",
        ),
        max_workers: integerSchema("Alias for max_concurrency."),
        max_runtime_seconds: integerSchema(
          "Maximum runtime per worker before it is failed.",
        ),
        output_schema: objectSchema({}),
      },
      ["csv_path", "instruction"],
    ),
    placeholder(
      "report_agent_job_result",
      "Worker-only tool to report a result for an agent job item. Main agents should not call this.",
      {
        job_id: stringSchema("Identifier of the job."),
        item_id: stringSchema("Identifier of the job item."),
        result: objectSchema({}),
        stop: booleanSchema(
          "When true, cancels the remaining job items after this result is recorded.",
        ),
      },
      ["job_id", "item_id", "result"],
    ),
  ];
}

function placeholder(
  name: string,
  description: string,
  properties: Record<string, Record<string, unknown>>,
  required: string[],
): ToolDefinition {
  return {
    name,
    supportsParallelToolCalls: false,
    schema: functionTool(name, description, objectSchema(properties, required)),
    execute: async () => ({
      output: JSON.stringify({
        status: "unavailable",
        message: `${name} requires the Rust Codex agent-job task runtime; no TypeScript backend is configured.`,
      }),
    }),
  };
}
