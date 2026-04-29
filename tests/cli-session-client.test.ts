import test from "node:test";
import assert from "node:assert/strict";
import {
  CliSessionController,
  WELCOME_LOGO,
  interactiveHelp,
  printWelcomeLogo,
  type CliSessionTransport,
} from "../src/cli/session-client.js";
import type { SessionNotification } from "../src/session/client.js";

test("CLI session controller initializes socket, starts session, and renders status", async () => {
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
  await controller.startSession();
  const status = await controller.handleCommand("/status");

  assert.deepEqual(
    transport.requests.map((request) => request.method),
    ["initialize", "session/start", "command/execute"],
  );
  assert.deepEqual(status, { handled: true, shouldExit: false });
  assert.equal(
    stdout.at(-1),
    "server: ndx-ts-session-server\nsession: empty session-1 (idle)",
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
  await controller.startSession();
  const run = controller.runPrompt("hello");
  transport.emit({
    method: "session/configured",
    params: {
      sessionId: "session-1",
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
      sessionId: "session-1",
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
    params: {
      name: "events",
      args: undefined,
      sessionId: "session-1",
      cwd: "/workspace",
    },
  });
});

test("interactive help advertises session client commands", () => {
  assert.equal(interactiveHelp().includes("/interrupt"), true);
  assert.equal(interactiveHelp().includes("/events"), true);
  assert.equal(interactiveHelp().includes("/session"), true);
  assert.equal(interactiveHelp().includes("/restore"), true);
});

test("welcome logo emits the configured robot art", () => {
  const stderr: string[] = [];
  printWelcomeLogo((message) => stderr.push(message));

  assert.equal(stderr[0], WELCOME_LOGO);
  assert.equal(WELCOME_LOGO.startsWith("⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣺⣟⣿⢶⣄"), true);
  assert.equal(WELCOME_LOGO.includes("⠸⡷⣟⡿⣯⢿⡾⡷⡿⣯⣟⣯⢿⣳⡿⣽⣟⣿⢽⣟⡿⣯⢿⣻⣯⢿⣽⢾⣻⡾⣟⣿⣻⣽⡾⣟⣷⢿⡽⣿⣻⣟⣷⠇"), true);
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
  await controller.startSession();
  const result = await controller.handleCommand("/diff");

  assert.deepEqual(result, { handled: true, shouldExit: false });
  assert.equal(stdout.at(-1), "/diff is registered but is not implemented yet");
  assert.equal(
    transport.requests.some((request) => request.method === "turn/start"),
    false,
  );
});

test("CLI session controller switches active session after restore command", async () => {
  const transport = new FakeTransport();
  const stdout: string[] = [];
  const controller = new CliSessionController({
    client: transport,
    cwd: "/workspace",
    print: (message) => stdout.push(message),
  });

  await controller.initialize();
  await controller.startSession();
  const result = await controller.handleCommand("/restore 2");

  assert.deepEqual(result, { handled: true, shouldExit: false });
  assert.equal(stdout.at(-1), "restored session 2: restored title");
  assert.deepEqual(transport.requests.at(-1), {
    method: "command/execute",
    params: {
      name: "restore",
      args: "2",
      sessionId: "session-1",
      cwd: "/workspace",
    },
  });

  const run = controller.runPrompt("continue");
  transport.emit({
    method: "turn/completed",
    params: {
      sessionId: "session-2",
      event: {
        type: "turn_complete",
        sessionId: "session-2",
        turnId: "turn-2",
        finalText: "continued",
      },
    },
  });
  await run;
  assert.equal(
    transport.requests.some(
      (request) =>
        request.method === "turn/start" &&
        (request.params as { sessionId?: string }).sessionId === "session-2",
    ),
    true,
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
          "session/start",
          "turn/start",
        ],
      } as T;
    }
    if (method === "session/start") {
      return {
        session: {
          id: "session-1",
          cwd: "/workspace",
          status: "idle",
          model: "mock",
          createdAt: 1,
          updatedAt: 1,
          title: "empty",
        },
      } as T;
    }
    if (method === "turn/start") {
      return { turn: { id: "turn-1", status: "in_progress" } } as T;
    }
    if (method === "turn/interrupt") {
      return { session: { id: "session-1" } } as T;
    }
    if (method === "command/execute") {
      const command = params as { name: string };
      if (command.name === "status") {
        return {
          handled: true,
          action: "print",
          output:
            "server: ndx-ts-session-server\nsession: empty session-1 (idle)",
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
      if (command.name === "restore") {
        return {
          handled: true,
          action: "restore",
          output: "restored session 2: restored title",
          session: {
            id: "session-2",
            cwd: "/workspace",
            status: "idle",
            model: "mock",
            createdAt: 1,
            updatedAt: 2,
            number: 2,
            title: "restored title",
          },
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
