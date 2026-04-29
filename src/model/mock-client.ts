import type { ModelClient, ModelResponse } from "../shared/types.js";

export class MockModelClient implements ModelClient {
  private step = 0;

  async create(input: unknown): Promise<ModelResponse> {
    if (this.step === 0) {
      this.step += 1;
      const prompt = String(input);
      return {
        id: "mock-response-1",
        text: "",
        toolCalls: [
          {
            callId: "mock-call-1",
            name: "shell",
            arguments: JSON.stringify({ command: commandForPrompt(prompt) }),
          },
        ],
        raw: { mock: true },
      };
    }

    this.step += 1;
    return {
      id: `mock-response-${this.step}`,
      text: "mock agent completed",
      toolCalls: [],
      raw: { input },
    };
  }
}

function commandForPrompt(prompt: string): string {
  const createFile = /create a file named\s+([^\s]+)\s+with text\s+(.+)$/i.exec(
    prompt.trim(),
  );
  if (createFile) {
    const file = shellQuote(createFile[1] ?? "tmp/ndx-mock.txt");
    const text = shellQuote(createFile[2] ?? "verified");
    return `mkdir -p "$(dirname ${file})" && printf %s ${text} > ${file} && cat ${file}`;
  }
  return "pwd && ls -1 | sed -n '1,20p'";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
