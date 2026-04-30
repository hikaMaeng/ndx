import { createServer, type ServerResponse } from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { createProviderModelClient } from "../src/model/factory.js";
import { RoundRobinModelRouter } from "../src/model/router.js";
import { normalizeAnthropicResponse } from "../src/model/anthropic.js";
import { normalizeChatResponse } from "../src/model/openai-chat.js";
import {
  normalizeResponsesPayload,
  optionalProviderParameters,
  responsesInput,
  responsesTools,
} from "../src/model/openai-responses.js";
import type { ModelResponse, NdxConfig } from "../src/shared/types.js";

test("normalizes OpenAI responses function calls and usage", () => {
  assert.deepEqual(
    normalizeResponsesPayload({
      id: "resp-1",
      output: [
        {
          type: "function_call",
          call_id: "call-1",
          name: "shell",
          arguments: '{"command":"pwd"}',
        },
      ],
      usage: {
        input_tokens: 3,
        output_tokens: 4,
        total_tokens: 7,
      },
    }),
    {
      id: "resp-1",
      text: "",
      toolCalls: [
        {
          callId: "call-1",
          name: "shell",
          arguments: '{"command":"pwd"}',
        },
      ],
      usage: {
        inputTokens: 3,
        outputTokens: 4,
        totalTokens: 7,
      },
      raw: {
        id: "resp-1",
        output: [
          {
            type: "function_call",
            call_id: "call-1",
            name: "shell",
            arguments: '{"command":"pwd"}',
          },
        ],
        usage: {
          input_tokens: 3,
          output_tokens: 4,
          total_tokens: 7,
        },
      },
    },
  );
});

test("converts chat-compatible function tools for OpenAI responses", () => {
  assert.deepEqual(
    responsesTools([
      {
        type: "function",
        function: {
          name: "shell",
          description: "Run a shell command.",
          parameters: {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
          },
        },
      },
    ]),
    [
      {
        type: "function",
        name: "shell",
        description: "Run a shell command.",
        parameters: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
    ],
  );
});

test("model request options expose effort, thinking, and sampling parameters", () => {
  assert.deepEqual(
    optionalProviderParameters({
      model: "qwen",
      instructions: "test",
      apiKey: "",
      baseUrl: "http://localhost/v1",
      effort: "high",
      think: false,
      limitResponseLength: 1024,
      topK: 40,
      repeatPenalty: 1.1,
      presencePenalty: 0.2,
      topP: 0.9,
      MinP: 0.05,
    }),
    {
      reasoning_effort: "high",
      think: false,
      max_tokens: 1024,
      max_output_tokens: 1024,
      top_k: 40,
      repeat_penalty: 1.1,
      presence_penalty: 0.2,
      top_p: 0.9,
      min_p: 0.05,
    },
  );
});

test("converts restored conversation history for OpenAI responses", () => {
  assert.deepEqual(
    responsesInput([
      { type: "message", role: "user", content: "make test1" },
      {
        type: "assistant_tool_calls",
        toolCalls: [
          {
            callId: "restored-call-1",
            name: "shell",
            arguments: '{"command":"mkdir test1"}',
          },
        ],
      },
      {
        type: "function_call_output",
        call_id: "restored-call-1",
        output: '{"exitCode":0}',
      },
      { type: "message", role: "assistant", content: "done" },
      { type: "message", role: "user", content: "make test2" },
    ]),
    [
      { role: "user", content: "make test1" },
      {
        type: "function_call",
        call_id: "restored-call-1",
        name: "shell",
        arguments: '{"command":"mkdir test1"}',
      },
      {
        type: "function_call_output",
        call_id: "restored-call-1",
        output: '{"exitCode":0}',
      },
      { role: "assistant", content: "done" },
      { role: "user", content: "make test2" },
    ],
  );
});

test("OpenAI responses adapter always sends client-side context without previous_response_id", async () => {
  const bodies: unknown[] = [];
  const server = createServer(async (request, response) => {
    assert.equal(request.url, "/v1/responses");
    bodies.push(await readJson(request));
    writeJson(response, 200, {
      id: `resp-${bodies.length}`,
      output_text: bodies.length === 1 ? "" : "done",
      output:
        bodies.length === 1
          ? [
              {
                type: "function_call",
                call_id: "call-1",
                name: "shell",
                arguments: "{}",
              },
            ]
          : [],
    });
  });
  const baseUrl = await listen(server);
  try {
    const client = createProviderModelClient(
      configFor("openai", `${baseUrl}/v1`),
    );
    await client.create([
      { type: "message", role: "user", content: "first" },
      {
        type: "assistant_tool_calls",
        toolCalls: [{ callId: "call-1", name: "shell", arguments: "{}" }],
      },
      {
        type: "function_call_output",
        call_id: "call-1",
        output: "{}",
      },
    ]);

    assert.equal(
      bodies.some(
        (body) =>
          typeof body === "object" &&
          body !== null &&
          "previous_response_id" in body,
      ),
      false,
    );
  } finally {
    await close(server);
  }
});

test("normalizes chat completions function calls", () => {
  const normalized = normalizeChatResponse({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "shell",
                arguments: '{"command":"ls"}',
              },
            },
          ],
        },
      },
    ],
  });
  assert.deepEqual(normalized.toolCalls, [
    {
      callId: "call-1",
      name: "shell",
      arguments: '{"command":"ls"}',
    },
  ]);
});

test("normalizes Anthropic messages tool use", () => {
  const normalized = normalizeAnthropicResponse({
    id: "msg-1",
    content: [
      { type: "text", text: "hello" },
      {
        type: "tool_use",
        id: "toolu-1",
        name: "shell",
        input: { command: "pwd" },
      },
    ],
    usage: {
      input_tokens: 5,
      output_tokens: 6,
    },
  });
  assert.equal(normalized.text, "hello");
  assert.deepEqual(normalized.toolCalls, [
    {
      callId: "toolu-1",
      name: "shell",
      arguments: '{"command":"pwd"}',
    },
  ]);
  assert.deepEqual(normalized.usage, {
    inputTokens: 5,
    outputTokens: 6,
    totalTokens: 11,
  });
});

test("OpenAI provider prefers responses and falls back to chat completions on missing endpoint", async () => {
  const seen: string[] = [];
  const server = createServer(async (request, response) => {
    seen.push(request.url ?? "");
    if (request.url === "/v1/responses") {
      writeJson(response, 404, { error: "missing" });
      return;
    }
    assert.equal(request.url, "/v1/chat/completions");
    writeJson(response, 200, {
      choices: [{ message: { content: "chat-ok" } }],
    });
  });
  const baseUrl = await listen(server);
  try {
    const client = createProviderModelClient(
      configFor("openai", `${baseUrl}/v1`),
    );
    const response = await client.create("hello", []);
    assert.equal(response.text, "chat-ok");
    assert.deepEqual(seen, ["/v1/responses", "/v1/chat/completions"]);
  } finally {
    await close(server);
  }
});

test("model router keeps a sticky model per selected pool and honors custom prompt keywords", async () => {
  const models: string[] = [];
  const router = new RoundRobinModelRouter(configWithPools(), (config) => {
    return {
      async create(): Promise<ModelResponse> {
        models.push(config.model);
        return { text: config.model, toolCalls: [], raw: {} };
      },
    };
  });

  await router.create([{ type: "message", role: "user", content: "one" }]);
  await router.create([{ type: "message", role: "user", content: "two" }]);
  await router.create([
    { type: "message", role: "user", content: "@deep inspect" },
  ]);
  await router.create([
    { type: "message", role: "user", content: "@deep inspect again" },
  ]);
  await router.create([
    { type: "function_call_output", call_id: "call-1", output: "{}" },
  ]);

  assert.deepEqual(models, [
    "session-a",
    "session-a",
    "reviewer-a",
    "reviewer-a",
    "reviewer-a",
  ]);
});

function configFor(type: "openai" | "anthropic", url: string): NdxConfig {
  return {
    model: "test-model",
    modelPools: {
      session: ["test-model"],
      worker: [],
      reviewer: [],
      custom: {},
    },
    instructions: "test instructions",
    env: {},
    keys: {},
    maxTurns: 4,
    shellTimeoutMs: 30_000,
    providers: {
      test: {
        type,
        key: "",
        url,
      },
    },
    models: [{ name: "test-model", provider: "test" }],
    activeModel: { name: "test-model", provider: "test" },
    activeProvider: { type, key: "", url },
    permissions: { defaultMode: "danger-full-access" },
    websearch: {},
    search: {},
    mcp: {},
    globalMcp: {},
    projectMcp: {},
    plugins: [],
    tools: { imageGeneration: false },
    paths: { globalDir: "/tmp/ndx-empty-global" },
  };
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function configWithPools(): NdxConfig {
  return {
    ...configFor("openai", "http://localhost/v1"),
    model: "session-a",
    modelPools: {
      session: ["session-a", "session-b"],
      worker: [],
      reviewer: [],
      custom: {
        deep: ["reviewer-a", "reviewer-b"],
      },
    },
    models: [
      { name: "session-a", provider: "test" },
      { name: "session-b", provider: "test" },
      { name: "reviewer-a", provider: "test" },
      { name: "reviewer-b", provider: "test" },
    ],
    activeModel: { name: "session-a", provider: "test" },
  };
}

async function listen(
  server: ReturnType<typeof createServer>,
): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.notEqual(address, null);
  assert.notEqual(typeof address, "string");
  return `http://127.0.0.1:${(address as { port: number }).port}`;
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
