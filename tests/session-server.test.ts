import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { MockModelClient } from "../src/model/mock-client.js";
import {
  SessionClient,
  type SessionNotification,
} from "../src/session/client.js";
import { SessionServer } from "../src/session/server.js";
import type { NdxConfig } from "../src/shared/types.js";

const baseConfig: NdxConfig = {
  model: "mock",
  instructions: "test",
  env: {},
  keys: {},
  maxTurns: 4,
  shellTimeoutMs: 30_000,
  providers: {
    mock: {
      type: "openai",
      key: "",
      url: "http://localhost/v1",
    },
  },
  models: [
    {
      name: "mock",
      provider: "mock",
    },
  ],
  activeModel: {
    name: "mock",
    provider: "mock",
  },
  activeProvider: {
    type: "openai",
    key: "",
    url: "http://localhost/v1",
  },
  permissions: {
    defaultMode: "danger-full-access",
  },
  websearch: {},
  search: {},
  mcp: {},
  globalMcp: {},
  projectMcp: {},
  plugins: [],
  tools: { imageGeneration: false },
  paths: {
    globalDir: "/home/.ndx",
  },
};

test("session server owns thread events, subscribers, and JSONL persistence", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-session-server-"));
  const globalDir = join(root, "home", ".ndx");
  const persistenceDir = join(root, "server-sessions");
  const notifications: SessionNotification[] = [];
  const subscriberNotifications: SessionNotification[] = [];
  let server: SessionServer | undefined;
  let client: SessionClient | undefined;
  let subscriber: SessionClient | undefined;

  try {
    writeShellTool(join(globalDir, "core", "tools", "shell"));
    server = new SessionServer({
      cwd: root,
      config: { ...baseConfig, paths: { globalDir } },
      sources: [join(globalDir, "settings.json")],
      createClient: () => new MockModelClient(),
      persistenceDir,
    });
    const address = await server.listen(0, "127.0.0.1");
    client = await SessionClient.connect(address.url);
    subscriber = await SessionClient.connect(address.url);
    client.onNotification((notification) => notifications.push(notification));
    subscriber.onNotification((notification) =>
      subscriberNotifications.push(notification),
    );

    await client.request("initialize");
    await subscriber.request("initialize");
    const startResponse = await client.request<{ thread: { id: string } }>(
      "thread/start",
      { cwd: root },
    );
    const threadId = startResponse.thread.id;
    await subscriber.request("thread/subscribe", { threadId });

    const completed = waitForMethod(subscriber, "turn/completed");
    await client.request("turn/start", {
      threadId,
      prompt: "list files",
    });
    await completed;
    await server.flushPersistence();

    assert.deepEqual(
      notifications.map((notification) => notification.method),
      [
        "thread/started",
        "thread/sessionConfigured",
        "turn/started",
        "item/toolCall",
        "item/toolResult",
        "item/agentMessage",
        "turn/completed",
      ],
    );
    assert.equal(
      subscriberNotifications.some(
        (notification) => notification.method === "turn/completed",
      ),
      true,
    );

    const readResponse = await subscriber.request<{
      thread: { id: string; status: string };
      events: unknown[];
    }>("thread/read", { threadId });
    assert.equal(readResponse.thread.id, threadId);
    assert.equal(readResponse.thread.status, "idle");
    assert.equal(readResponse.events.length >= 6, true);

    const logFile = join(persistenceDir, `${threadId}.jsonl`);
    assert.equal(existsSync(logFile), true);
    let records = readJsonl(logFile);
    assert.equal(
      records.some((record) => record.type === "thread_started"),
      true,
    );
    assert.equal(
      records.some((record) => record.type === "runtime_event"),
      true,
    );
    assert.equal(
      records.some((record) => record.type === "notification"),
      true,
    );
    assert.equal(
      records.every(
        (record) =>
          typeof record.writerPid === "number" &&
          record.writerPid !== process.pid,
      ),
      true,
    );

    client.close();
    subscriber.close();
    records = await waitForLogRecord(
      logFile,
      (record) => record.type === "thread_detached",
    );
    assert.equal(
      records.some((record) => record.type === "thread_detached"),
      true,
    );
  } finally {
    client?.close();
    subscriber?.close();
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function waitForMethod(
  client: SessionClient,
  method: string,
): Promise<SessionNotification> {
  return new Promise((resolve) => {
    const off = client.onNotification((notification) => {
      if (notification.method === method) {
        off();
        resolve(notification);
      }
    });
  });
}

async function waitForLogRecord(
  file: string,
  predicate: (record: Record<string, unknown>) => boolean,
): Promise<Array<Record<string, unknown>>> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const records = readJsonl(file);
      if (records.some(predicate)) {
        return records;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`timed out waiting for log record in ${file}`);
}

function readJsonl(file: string): Array<Record<string, unknown>> {
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function writeShellTool(toolDir: string): void {
  mkdirSync(toolDir, { recursive: true });
  writeFileSync(
    join(toolDir, "tool.json"),
    JSON.stringify({
      type: "function",
      function: {
        name: "shell",
        description: "Run a shell command.",
        parameters: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
          additionalProperties: false,
        },
      },
      command: "node",
      args: ["tool.mjs"],
    }),
  );
  writeFileSync(
    join(toolDir, "tool.mjs"),
    'import { stdout } from "node:process"; stdout.write(JSON.stringify({ exitCode: 0, stdout: "", stderr: "" }) + "\\n");\n',
  );
}
