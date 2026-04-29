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
import type { RuntimeEventMsg } from "../src/shared/protocol.js";
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

test("session server owns session events, subscribers, and JSONL persistence", async () => {
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

    const initialize = await client.request<{
      bootstrap: {
        globalDir: string;
        elements: Array<{ name: string; status: string; path: string }>;
      };
    }>("initialize");
    await subscriber.request("initialize");
    assert.equal(initialize.bootstrap.globalDir, globalDir);
    assert.equal(existsSync(join(globalDir, "settings.json")), true);
    assert.equal(existsSync(join(globalDir, "skills")), true);
    assert.equal(
      initialize.bootstrap.elements.some(
        (element) =>
          element.name === "settings.json" && element.status === "installed",
      ),
      true,
    );
    const commandList = await client.request<{
      commands: Array<{
        name: string;
        placement: string;
        implemented: boolean;
      }>;
    }>("command/list");
    assert.equal(
      commandList.commands.some(
        (command) =>
          command.name === "compact" && command.placement === "session-builtin",
      ),
      true,
    );
    assert.equal(
      commandList.commands.some(
        (command) =>
          command.name === "diff" && command.placement === "core-candidate",
      ),
      true,
    );
    const startResponse = await client.request<{
      session: { id: string; number?: number; title: string };
    }>("session/start", { cwd: root });
    const sessionId = startResponse.session.id;
    assert.equal(startResponse.session.number, undefined);
    assert.equal(startResponse.session.title, "empty");
    assert.equal(existsSync(join(persistenceDir, `${sessionId}.jsonl`)), false);
    await subscriber.request("session/subscribe", { sessionId });

    const completed = waitForMethod(subscriber, "turn/completed");
    await client.request("turn/start", {
      sessionId,
      prompt: "list files",
    });
    await completed;
    await server.flushPersistence();

    assert.deepEqual(
      notifications.map((notification) => notification.method),
      [
        "session/started",
        "session/configured",
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
    const configured = notificationEvent(notifications, "session/configured");
    assert.equal(configured?.type, "session_configured");
    if (configured?.type === "session_configured") {
      assert.equal(configured.bootstrap.globalDir, globalDir);
      assert.equal(
        configured.bootstrap.elements.some(
          (element) => element.name === "skills",
        ),
        true,
      );
    }

    const readResponse = await subscriber.request<{
      session: { id: string; status: string; number: number; title: string };
      events: unknown[];
    }>("session/read", { sessionId });
    assert.equal(readResponse.session.id, sessionId);
    assert.equal(readResponse.session.status, "idle");
    assert.equal(readResponse.session.number, 1);
    assert.equal(readResponse.session.title, "list files");
    assert.equal(readResponse.events.length >= 6, true);

    const status = await client.request<{ handled: true; output: string }>(
      "command/execute",
      { name: "status", sessionId },
    );
    assert.equal(
      status.output,
      `server: ndx-ts-session-server\nsession: 1 ${sessionId} (idle)`,
    );
    const events = await client.request<{ handled: true; output: string }>(
      "command/execute",
      { name: "events", sessionId },
    );
    assert.equal(events.output.includes("session_configured"), true);
    const init = await client.request<{ handled: true; output: string }>(
      "command/execute",
      { name: "init", sessionId },
    );
    assert.equal(init.output.includes("[bootstrap]"), true);
    assert.equal(init.output.includes("skills"), true);
    const unsupported = await client.request<{
      handled: false;
      output: string;
    }>("command/execute", { name: "diff", sessionId });
    assert.equal(unsupported.handled, false);
    assert.equal(unsupported.output.includes("core-candidate"), true);

    const sessionList = await client.request<{
      handled: true;
      output: string;
    }>("command/execute", { name: "session", cwd: root });
    assert.equal(sessionList.output.includes("sessions for"), true);
    assert.equal(sessionList.output.includes("0. new session"), true);
    assert.equal(sessionList.output.includes(`id: ${sessionId}`), true);

    const restoredByNumber = await client.request<{
      handled: true;
      action: "restore";
      session: { id: string };
    }>("command/execute", { name: "restore", args: "1", cwd: root });
    assert.equal(restoredByNumber.session.id, sessionId);

    const logFile = join(persistenceDir, `${sessionId}.jsonl`);
    assert.equal(existsSync(logFile), true);
    let records = readJsonl(logFile);
    assert.equal(
      records.some((record) => record.type === "session_started"),
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
      (record) => record.type === "session_detached",
    );
    assert.equal(
      records.some((record) => record.type === "session_detached"),
      true,
    );
  } finally {
    client?.close();
    subscriber?.close();
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session server restores a saved workspace session by id or number", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-session-restore-"));
  const globalDir = join(root, "home", ".ndx");
  const persistenceDir = join(root, "server-sessions");
  let firstServer: SessionServer | undefined;
  let secondServer: SessionServer | undefined;
  let firstClient: SessionClient | undefined;
  let secondClient: SessionClient | undefined;

  try {
    writeShellTool(join(globalDir, "core", "tools", "shell"));
    firstServer = new SessionServer({
      cwd: root,
      config: { ...baseConfig, paths: { globalDir } },
      sources: [join(globalDir, "settings.json")],
      createClient: () => new MockModelClient(),
      persistenceDir,
    });
    const firstAddress = await firstServer.listen(0, "127.0.0.1");
    firstClient = await SessionClient.connect(firstAddress.url);
    await firstClient.request("initialize");
    const startResponse = await firstClient.request<{
      session: { id: string };
    }>("session/start", { cwd: root });
    const originalSessionId = startResponse.session.id;
    const completed = waitForMethod(firstClient, "turn/completed");
    await firstClient.request("turn/start", {
      sessionId: originalSessionId,
      prompt: "first turn",
    });
    await completed;
    await firstServer.flushPersistence();
    firstClient.close();
    await firstServer.close();

    secondServer = new SessionServer({
      cwd: root,
      config: { ...baseConfig, paths: { globalDir } },
      sources: [join(globalDir, "settings.json")],
      createClient: () => new MockModelClient(),
      persistenceDir,
    });
    const secondAddress = await secondServer.listen(0, "127.0.0.1");
    secondClient = await SessionClient.connect(secondAddress.url);
    await secondClient.request("initialize");

    const listResponse = await secondClient.request<{
      sessions: Array<{
        number: number;
        id: string;
        eventCount: number;
        title: string;
      }>;
    }>("session/list", { cwd: root });
    assert.deepEqual(
      listResponse.sessions.map((session) => session.id),
      [originalSessionId],
    );
    assert.equal(listResponse.sessions[0]?.number, 1);
    assert.equal(listResponse.sessions[0]?.title, "first turn");
    assert.equal(listResponse.sessions[0]?.eventCount >= 6, true);

    const restoreResponse = await secondClient.request<{
      session: { id: string; status: string };
      events: unknown[];
    }>("session/restore", { cwd: root, selector: "1" });
    assert.equal(restoreResponse.session.id, originalSessionId);
    assert.equal(restoreResponse.session.status, "idle");
    assert.equal(restoreResponse.events.length >= 6, true);

    const completedAgain = waitForMethod(secondClient, "turn/completed");
    await secondClient.request("turn/start", {
      sessionId: originalSessionId,
      prompt: "second turn",
    });
    await completedAgain;
    await secondServer.flushPersistence();

    const records = readJsonl(
      join(persistenceDir, `${originalSessionId}.jsonl`),
    );
    assert.equal(
      records.some((record) => record.type === "session_restored"),
      true,
    );
    assert.equal(
      records.filter((record) => record.type === "turn_start_requested").length,
      2,
    );
  } finally {
    firstClient?.close();
    secondClient?.close();
    await firstServer?.close().catch(() => undefined);
    await secondServer?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session ownership uses last prompt attempt across socket servers", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-session-owner-"));
  const globalDir = join(root, "home", ".ndx");
  const persistenceDir = join(root, "server-sessions");
  let firstServer: SessionServer | undefined;
  let secondServer: SessionServer | undefined;
  let firstClient: SessionClient | undefined;
  let secondClient: SessionClient | undefined;

  try {
    writeShellTool(join(globalDir, "core", "tools", "shell"));
    firstServer = new SessionServer({
      cwd: root,
      config: { ...baseConfig, paths: { globalDir } },
      sources: [join(globalDir, "settings.json")],
      createClient: () => new MockModelClient(),
      persistenceDir,
    });
    secondServer = new SessionServer({
      cwd: root,
      config: { ...baseConfig, paths: { globalDir } },
      sources: [join(globalDir, "settings.json")],
      createClient: () => new MockModelClient(),
      persistenceDir,
    });
    firstClient = await SessionClient.connect(
      (await firstServer.listen(0, "127.0.0.1")).url,
    );
    secondClient = await SessionClient.connect(
      (await secondServer.listen(0, "127.0.0.1")).url,
    );
    await firstClient.request("initialize");
    await secondClient.request("initialize");

    const startResponse = await firstClient.request<{
      session: { id: string };
    }>("session/start", { cwd: root });
    const sessionId = startResponse.session.id;
    const firstCompleted = waitForMethod(firstClient, "turn/completed");
    await firstClient.request("turn/start", {
      sessionId,
      prompt: "first owner prompt",
    });
    await firstCompleted;
    await firstServer.flushPersistence();

    await secondClient.request("session/restore", { cwd: root, selector: "1" });
    await secondServer.flushPersistence();

    const ownershipChanged = waitForMethod(
      firstClient,
      "session/ownershipChanged",
    );
    const secondCompleted = waitForMethod(firstClient, "turn/completed");
    await firstClient.request("turn/start", {
      sessionId,
      prompt: "claim ownership again",
    });
    await ownershipChanged;
    await secondCompleted;
    await firstServer.flushPersistence();

    const records = readJsonl(join(persistenceDir, `${sessionId}.jsonl`));
    assert.equal(
      records.filter((record) => record.type === "turn_start_requested").length,
      2,
    );
  } finally {
    firstClient?.close();
    secondClient?.close();
    await firstServer?.close();
    await secondServer?.close();
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

function notificationEvent(
  notifications: SessionNotification[],
  method: string,
): RuntimeEventMsg | undefined {
  const notification = notifications.find((entry) => entry.method === method);
  if (
    notification?.params === null ||
    typeof notification?.params !== "object"
  ) {
    return undefined;
  }
  const event = (notification.params as { event?: unknown }).event;
  return event !== null && typeof event === "object"
    ? (event as RuntimeEventMsg)
    : undefined;
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
