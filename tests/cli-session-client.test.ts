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

const cliIdentity = { user: "defaultUser", clientId: "client-test" };
const clientIdentity = { clientId: "client-test" };

test("CLI session controller initializes socket, starts session, and renders status", async () => {
  const transport = new FakeTransport();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const controller = new CliSessionController({
    client: transport,
    cwd: "/workspace",
    ...cliIdentity,
    print: (message) => stdout.push(message),
    printError: (message) => stderr.push(message),
  });

  await controller.initialize();
  await controller.startSession();
  const status = await controller.handleCommand("/status");

  assert.deepEqual(
    transport.requests.map((request) => request.method),
    ["account/login", "initialize", "session/start", "command/execute"],
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
  assert.equal(
    stderr.join("\n").includes("[dashboard] http://127.0.0.1:45124"),
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
    ...cliIdentity,
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
        context: {
          restoredItems: 6,
          estimatedTokens: 120,
          maxContextTokens: 1000,
        },
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
      ...clientIdentity,
    },
  });
});

test("interactive help advertises session client commands", () => {
  assert.equal(interactiveHelp().includes("/interrupt"), true);
  assert.equal(interactiveHelp().includes("/login"), true);
  assert.equal(interactiveHelp().includes("/events"), true);
  assert.equal(interactiveHelp().includes("/session"), true);
  assert.equal(interactiveHelp().includes("/restoreSession"), true);
  assert.equal(interactiveHelp().includes("/deleteSession"), true);
});

test("CLI login command switches to default user and updates login store", async () => {
  const transport = new FakeTransport();
  const stdout: string[] = [];
  const saved: unknown[] = [];
  const answers = ["2", "4"];
  const controller = new CliSessionController({
    client: transport,
    cwd: "/workspace",
    clientId: "client-test",
    print: (message) => stdout.push(message),
    question: async () => answers.shift() ?? "4",
    loginStore: {
      load: () => ({
        kind: "password",
        username: "alice",
        password: "secret",
      }),
      save: (login) => saved.push(login),
      path: () => "/tmp/auth.json",
    },
  });

  await controller.initialize();
  const result = await controller.handleCommand("/login");

  assert.deepEqual(result, { handled: true, shouldExit: false });
  assert.deepEqual(
    transport.requests
      .filter((request) => request.method === "account/login")
      .map((request) => request.params),
    [
      { username: "alice", password: "secret", clientId: "client-test" },
      { username: "defaultUser", password: "", clientId: "client-test" },
    ],
  );
  assert.deepEqual(saved, [{ kind: "default", username: "defaultUser" }]);
  assert.equal(stdout.at(-1), "logged in as defaultUser");
});

test("welcome logo emits the configured robot art", () => {
  const stderr: string[] = [];
  printWelcomeLogo((message) => stderr.push(message));

  assert.equal(stderr[0], WELCOME_LOGO);
  assert.equal(WELCOME_LOGO.startsWith("⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣺⣟⣿⢶⣄"), true);
  assert.equal(
    WELCOME_LOGO.includes("⠸⡷⣟⡿⣯⢿⡾⡷⡿⣯⣟⣯⢿⣳⡿⣽⣟⣿⢽⣟⡿⣯⢿⣻⣯⢿⣽⢾⣻⡾⣟⣿⣻⣽⡾⣟⣷⢿⡽⣿⣻⣟⣷⠇"),
    true,
  );
});

test("CLI session controller does not send registered unsupported slash commands as prompts", async () => {
  const transport = new FakeTransport();
  const stdout: string[] = [];
  const controller = new CliSessionController({
    client: transport,
    cwd: "/workspace",
    ...cliIdentity,
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

test("CLI session controller switches active session after restoreSession command", async () => {
  const transport = new FakeTransport();
  const stdout: string[] = [];
  const controller = new CliSessionController({
    client: transport,
    cwd: "/workspace",
    ...cliIdentity,
    print: (message) => stdout.push(message),
  });

  await controller.initialize();
  await controller.startSession();
  const result = await controller.handleCommand("/restoreSession 2");

  assert.deepEqual(result, { handled: true, shouldExit: false });
  assert.equal(stdout.at(-1), "restored session 2: restored title");
  assert.deepEqual(transport.requests.at(-1), {
    method: "command/execute",
    params: {
      name: "restoreSession",
      args: "2",
      sessionId: "session-1",
      cwd: "/workspace",
      ...clientIdentity,
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

test("CLI session controller prompts before deleting another workspace session", async () => {
  const transport = new FakeTransport();
  const stdout: string[] = [];
  const questions: string[] = [];
  const answers = ["1", "2"];
  const controller = new CliSessionController({
    client: transport,
    cwd: "/workspace",
    ...cliIdentity,
    print: (message) => stdout.push(message),
    question: async (prompt) => {
      questions.push(prompt);
      return answers.shift() ?? "";
    },
  });

  await controller.initialize();
  await controller.startSession();
  const result = await controller.handleCommand("/deleteSession");

  assert.deepEqual(result, { handled: true, shouldExit: false });
  assert.deepEqual(questions, ["login> ", "deleteSession> "]);
  assert.equal(stdout.at(-1), "deleted session 2: restored title");
  assert.deepEqual(
    transport.requests.map((request) => request.method).slice(-2),
    ["session/deleteCandidates", "session/delete"],
  );
  assert.deepEqual(transport.requests.at(-1), {
    method: "session/delete",
    params: {
      cwd: "/workspace",
      selector: "2",
      currentSessionId: "session-1",
      ...clientIdentity,
    },
  });
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
        version: "0.1.8",
        protocolVersion: 1,
        dashboardUrl: "http://127.0.0.1:45124",
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
    if (method === "account/login") {
      return {
        username: "defaultUser",
        clientId: cliIdentity.clientId,
        sessionRoot: "/home/.ndx/system",
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
    if (method === "session/deleteCandidates") {
      return {
        sessions: [
          {
            number: 2,
            id: "session-2",
            cwd: "/workspace",
            status: "idle",
            createdAt: 1,
            updatedAt: 2,
            eventCount: 4,
            live: false,
            title: "restored title",
          },
        ],
      } as T;
    }
    if (method === "session/delete") {
      return { message: "deleted session 2: restored title" } as T;
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
            "  context: restored 6 items, 120/1000 tokens (12.0%)",
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
      if (command.name === "restoreSession") {
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
      if (command.name === "deleteSession") {
        return {
          handled: true,
          action: "deleteSession",
          output: "delete sessions for /workspace\nno deletable sessions",
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
