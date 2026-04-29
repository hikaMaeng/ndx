import test from "node:test";
import assert from "node:assert/strict";
import {
  CliSessionController,
  interactiveHelp,
  type CliSessionTransport,
} from "../src/cli/session-client.js";
import type { SessionNotification } from "../src/session/client.js";

test("CLI session controller initializes socket, starts thread, and renders status", async () => {
  const transport = new FakeTransport();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const controller = new CliSessionController({
    client: transport,
    cwd: "/workspace",
    print: (message) => stdout.push(message),
    printError: (message) => stderr.push(message),
  });

  await controller.initialize();
  await controller.startThread();
  const status = await controller.handleCommand("/status");

  assert.deepEqual(
    transport.requests.map((request) => request.method),
    ["initialize", "thread/start", "command/execute"],
  );
  assert.deepEqual(status, { handled: true, shouldExit: false });
  assert.equal(
    stdout.at(-1),
    "server: ndx-ts-session-server\nthread: thread-1 (idle)",
  );
  assert.equal(
    stderr
      .join("\n")
      .includes("[methods] initialize, command/list, command/execute"),
    true,
  );
});

test("CLI session controller records initialization events outside prompt context", async () => {
  const transport = new FakeTransport();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const controller = new CliSessionController({
    client: transport,
    cwd: "/workspace",
    print: (message) => stdout.push(message),
    printError: (message) => stderr.push(message),
  });

  await controller.initialize();
  await controller.startThread();
  const run = controller.runPrompt("hello");
  transport.emit({
    method: "thread/sessionConfigured",
    params: {
      threadId: "thread-1",
      event: {
        type: "session_configured",
        sessionId: "session-1",
        model: "mock",
        cwd: "/workspace",
        approvalPolicy: "never",
        sandboxMode: "danger-full-access",
        sources: ["/home/.ndx/settings.json", "/workspace/.ndx/settings.json"],
        bootstrap: bootstrapReport("/home/.ndx"),
      },
    },
  });
  transport.emit({
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      event: {
        type: "turn_complete",
        sessionId: "session-1",
        turnId: "turn-1",
        finalText: "done",
      },
    },
  });
  await run;
  await controller.handleCommand("/init");
  await controller.handleCommand("/events");

  assert.equal(stdout[0], "done");
  assert.equal(stdout[1].includes("sources: /home/.ndx/settings.json"), true);
  assert.equal(stdout[2], " 1. session_configured\n 2. turn_complete");
  assert.equal(
    stderr.some((message) => message.includes("[session-init]")),
    true,
  );
  assert.deepEqual(transport.requests.at(-1), {
    method: "command/execute",
    params: { name: "events", args: undefined, threadId: "thread-1" },
  });
});

test("interactive help advertises session client commands", () => {
  assert.equal(interactiveHelp().includes("/interrupt"), true);
  assert.equal(interactiveHelp().includes("/events"), true);
});

test("CLI session controller does not send registered unsupported slash commands as prompts", async () => {
  const transport = new FakeTransport();
  const stdout: string[] = [];
  const controller = new CliSessionController({
    client: transport,
    cwd: "/workspace",
    print: (message) => stdout.push(message),
  });

  await controller.initialize();
  await controller.startThread();
  const result = await controller.handleCommand("/diff");

  assert.deepEqual(result, { handled: true, shouldExit: false });
  assert.equal(stdout.at(-1), "/diff is registered but is not implemented yet");
  assert.equal(
    transport.requests.some((request) => request.method === "turn/start"),
    false,
  );
});

class FakeTransport implements CliSessionTransport {
  readonly requests: Array<{ method: string; params: unknown }> = [];
  private readonly handlers = new Set<
    (notification: SessionNotification) => void
  >();

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    this.requests.push({ method, params });
    if (method === "initialize") {
      return {
        server: "ndx-ts-session-server",
        protocolVersion: 1,
        bootstrap: bootstrapReport("/home/.ndx"),
        methods: [
          "initialize",
          "command/list",
          "command/execute",
          "thread/start",
          "turn/start",
        ],
      } as T;
    }
    if (method === "thread/start") {
      return {
        thread: {
          id: "thread-1",
          cwd: "/workspace",
          status: "idle",
          model: "mock",
          createdAt: 1,
          updatedAt: 1,
        },
      } as T;
    }
    if (method === "turn/start") {
      return { turn: { id: "turn-1", status: "in_progress" } } as T;
    }
    if (method === "turn/interrupt") {
      return { thread: { id: "thread-1" } } as T;
    }
    if (method === "command/execute") {
      const command = params as { name: string };
      if (command.name === "status") {
        return {
          handled: true,
          action: "print",
          output: "server: ndx-ts-session-server\nthread: thread-1 (idle)",
        } as T;
      }
      if (command.name === "init") {
        return {
          handled: true,
          action: "print",
          output: [
            "[session-init]",
            "  session: session-1",
            "  cwd: /workspace",
            "  model: mock",
            "  approval: never",
            "  sandbox: danger-full-access",
            "  sources: /home/.ndx/settings.json, /workspace/.ndx/settings.json",
            "[bootstrap] /home/.ndx",
            "  installed: 0",
            "  existing: 1",
            "  existing: settings.json (/home/.ndx/settings.json)",
          ].join("\n"),
        } as T;
      }
      if (command.name === "events") {
        return {
          handled: true,
          action: "print",
          output: " 1. session_configured\n 2. turn_complete",
        } as T;
      }
      if (command.name === "diff") {
        return {
          handled: false,
          output: "/diff is registered but is not implemented yet",
        } as T;
      }
    }
    throw new Error(`unexpected request: ${method}`);
  }

  onNotification(
    handler: (notification: SessionNotification) => void,
  ): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  emit(notification: SessionNotification): void {
    for (const handler of this.handlers) {
      handler(notification);
    }
  }
}

function bootstrapReport(globalDir: string) {
  return {
    globalDir,
    checkedAt: 1,
    elements: [
      {
        name: "settings.json",
        path: `${globalDir}/settings.json`,
        status: "existing",
      },
    ],
  };
}
