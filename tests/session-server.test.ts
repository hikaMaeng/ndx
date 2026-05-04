import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { MockModelClient } from "../src/model/mock-client.js";
import {
  SessionClient,
  type SessionNotification,
} from "../src/session/client.js";
import { SessionServer } from "../src/session/server.js";
import type { RuntimeEventMsg } from "../src/shared/protocol.js";
import type {
  ModelClient,
  ModelResponse,
  NdxConfig,
} from "../src/shared/types.js";

const baseConfig: NdxConfig = {
  model: "mock",
  modelPools: { session: ["mock"], worker: [], reviewer: [], custom: {} },
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

test("session server owns session events, subscribers, and SQLite persistence", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-session-server-"));
  const globalDir = join(root, "home", ".ndx");
  const persistenceDir = join(root, "server-sessions");
  const notifications: SessionNotification[] = [];
  const subscriberNotifications: SessionNotification[] = [];
  let server: SessionServer | undefined;
  let client: SessionClient | undefined;
  let subscriber: SessionClient | undefined;

  try {
    writeShellTool(join(globalDir, "system", "tools", "shell"));
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

    const info = await client.request<{
      server: string;
      version: string;
      runtime: { kind: string; node: string };
      toolSandbox: { kind: string; image: string };
    }>("server/info");
    assert.equal(info.server, "ndx-ts-session-server");
    assert.equal(info.runtime.kind, "host-process");
    assert.equal(info.runtime.node.startsWith("v"), true);
    assert.equal(info.toolSandbox.kind, "disabled");
    assert.equal(info.toolSandbox.image, "hika00/ndx-sandbox:0.1.1");

    await loginClient(client);
    const initialize = await client.request<{
      bootstrap: {
        globalDir: string;
        elements: Array<{ name: string; status: string; path: string }>;
      };
    }>("initialize");
    await initializeAndLoginClient(subscriber);
    assert.equal(initialize.bootstrap.globalDir, globalDir);
    assert.equal(existsSync(join(globalDir, "settings.json")), false);
    assert.equal(existsSync(join(globalDir, "system", "skills")), true);
    assert.equal(
      initialize.bootstrap.elements.some(
        (element) =>
          element.name === "system/skills" && element.status === "installed",
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
          command.name === "context" && command.placement === "session-builtin",
      ),
      true,
    );
    assert.equal(
      commandList.commands.some(
        (command) =>
          command.name === "lite" && command.placement === "session-builtin",
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
          (element) => element.name === "system/skills",
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
      [
        "server: ndx-ts-session-server",
        `session: 1 ${sessionId} (idle)`,
        "model: mock (mock)",
        "effort: unsupported",
        "think: unsupported",
      ].join("\n"),
    );
    const context = await client.request<{ handled: true; output: string }>(
      "command/execute",
      { name: "context", sessionId },
    );
    assert.equal(context.output.includes("current context"), true);
    assert.equal(context.output.includes("by kind:"), true);
    assert.equal(context.output.includes("remaining:"), true);
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
    }>("command/execute", { name: "restoreSession", args: "1", cwd: root });
    assert.equal(restoredByNumber.session.id, sessionId);

    assert.equal(existsSync(join(persistenceDir, "ndx.sqlite")), true);
    let records = readSqliteRecords(persistenceDir, sessionId);
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
    const projection = readSqliteSessionProjection(persistenceDir, sessionId);
    assert.equal(projection?.eventCount, readResponse.events.length);
    assert.equal(projection?.lastEventId !== undefined, true);
    const meta = readSqliteSessionMeta(persistenceDir, sessionId);
    assert.equal(meta?.sessionid, sessionId);
    assert.equal(meta?.userid, "defaultUser");
    assert.equal(meta?.projectid, readProjectId(root));
    assert.equal(meta?.path, root);
    assert.equal(meta?.islite, 0);
    assert.equal(meta?.ownerid, "test-client");
    assert.equal(typeof meta?.lastlogin, "number");
    const sessionData = readSqliteSessionData(persistenceDir, sessionId);
    assert.equal(sessionData.length, records.length);
    assert.equal(sessionData[0]?.type, "session_started");
    assert.equal(sessionData[0]?.sessionrowid, meta?.rowid);
    const contextEvents = readSqliteContextEvents(persistenceDir, sessionId);
    assert.deepEqual(
      contextEvents.map((event) => event.type),
      [
        "turn_started",
        "tool_call",
        "tool_result",
        "agent_message",
        "turn_complete",
      ],
    );
    const tables = readSqliteTableNames(persistenceDir);
    assert.deepEqual(
      [
        "projects",
        "sessions",
        "session_events",
        "session_context_items",
        "session_context_state",
        "session_context_segments",
        "session_owners",
      ].filter((table) => tables.includes(table)),
      [],
    );

    client.close();
    subscriber.close();
    records = await waitForSqliteRecord(
      persistenceDir,
      sessionId,
      (record) => record.type === "session_detached",
    );
    const detachedMeta = readSqliteSessionMeta(persistenceDir, sessionId);
    assert.equal(detachedMeta?.ownerid, "test-client");
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

test("project identity is stored in .ndx/.project and scopes sessions by account and project id", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-session-project-id-"));
  const globalDir = join(root, "home", ".ndx");
  const persistenceDir = join(root, "server-sessions");
  let server: SessionServer | undefined;
  let client: SessionClient | undefined;

  try {
    writeShellTool(join(globalDir, "system", "tools", "shell"));
    server = new SessionServer({
      cwd: root,
      config: { ...baseConfig, paths: { globalDir } },
      sources: [join(globalDir, "settings.json")],
      createClient: () => new MockModelClient(),
      persistenceDir,
    });
    client = await SessionClient.connect(
      (await server.listen(0, "127.0.0.1")).url,
    );
    await initializeAndLoginClient(client);

    const first = await createPersistedSession(
      client,
      root,
      "first project identity prompt",
    );
    await server.flushPersistence();
    const firstProjectId = readProjectId(root);
    assert.equal(readSqliteSessionMeta(persistenceDir, first)?.projectid, firstProjectId);

    rmSync(join(root, ".ndx"), { recursive: true, force: true });
    const second = await createPersistedSession(
      client,
      root,
      "second project identity prompt",
    );
    await server.flushPersistence();
    const secondProjectId = readProjectId(root);

    assert.notEqual(secondProjectId, firstProjectId);
    assert.equal(readSqliteSessionMeta(persistenceDir, second)?.projectid, secondProjectId);

    const listed = await client.request<{
      sessions: Array<{ id: string; projectId: string }>;
    }>("session/list", { cwd: root });
    assert.deepEqual(
      listed.sessions.map((session) => session.id),
      [second],
    );
    assert.deepEqual(
      listed.sessions.map((session) => session.projectId),
      [secondProjectId],
    );
  } finally {
    client?.close();
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session server keeps sessions on the base config while model routing happens per request", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-session-model-pool-"));
  const globalDir = join(root, "home", ".ndx");
  const assignedModels: string[] = [];
  let server: SessionServer | undefined;
  let client: SessionClient | undefined;

  try {
    const config: NdxConfig = {
      ...baseConfig,
      model: "mock-a",
      modelPools: {
        session: ["mock-a", "mock-b"],
        worker: ["mock-worker"],
        reviewer: ["mock-reviewer"],
        custom: {},
      },
      models: [
        { name: "mock-a", provider: "mock" },
        {
          id: "mock-b",
          name: "provider-mock-b",
          provider: "mock",
          effort: ["low", "medium", "high"],
          activeEffort: "low",
          think: true,
          activeThink: true,
        },
        { name: "mock-worker", provider: "mock" },
        { name: "mock-reviewer", provider: "mock" },
      ],
      activeModel: { name: "mock-a", provider: "mock" },
    };
    server = new SessionServer({
      cwd: root,
      config: { ...config, paths: { globalDir, dataDir: join(root, "data") } },
      sources: [join(globalDir, "settings.json")],
      createClient: (runtimeConfig) => {
        assignedModels.push(runtimeConfig.model);
        return new MockModelClient();
      },
    });
    client = await SessionClient.connect(
      (await server.listen(0, "127.0.0.1")).url,
    );
    await initializeAndLoginClient(client);

    const first = await client.request<{
      session: { id: string; model: string };
    }>("session/start", { cwd: root });
    const second = await client.request<{
      session: { id: string; model: string };
    }>("session/start", { cwd: root });
    const third = await client.request<{
      session: { id: string; model: string };
    }>("session/start", { cwd: root });

    assert.deepEqual(assignedModels, ["mock-a", "mock-a", "mock-a"]);
    assert.deepEqual(
      [first.session.model, second.session.model, third.session.model],
      ["mock-a", "mock-a", "mock-a"],
    );
    const switched = await client.request<{ handled: true; output: string }>(
      "command/execute",
      {
        name: "model",
        args: "mock-b effort high think off",
        sessionId: first.session.id,
      },
    );
    assert.equal(
      switched.output.includes("model: mock-b -> provider-mock-b"),
      true,
    );
    assert.equal(switched.output.includes("effort: high"), true);
    assert.equal(switched.output.includes("think: off"), true);
    const status = await client.request<{ handled: true; output: string }>(
      "command/execute",
      { name: "status", sessionId: first.session.id },
    );
    assert.equal(
      status.output.includes("model: mock-b (provider-mock-b)"),
      true,
    );
    assert.equal(status.output.includes("effort: high"), true);
    assert.equal(status.output.includes("think: off"), true);

    const selectedByNumber = await client.request<{
      handled: true;
      output: string;
    }>("command/execute", {
      name: "model",
      args: "1",
      sessionId: first.session.id,
    });
    assert.equal(
      selectedByNumber.output.includes("model: mock-a -> mock-a"),
      true,
    );
    assert.equal(selectedByNumber.output.includes("effort: unsupported"), true);
    assert.equal(selectedByNumber.output.includes("think: unsupported"), true);

    const selectedConfigurableByNumber = await client.request<{
      handled: true;
      output: string;
    }>("command/execute", {
      name: "model",
      args: "2",
      sessionId: first.session.id,
    });
    assert.equal(
      selectedConfigurableByNumber.output.includes(
        "model: mock-b -> provider-mock-b",
      ),
      true,
    );
    assert.equal(
      selectedConfigurableByNumber.output.includes("effort: medium"),
      true,
    );
    assert.equal(
      selectedConfigurableByNumber.output.includes("think: on"),
      true,
    );

    const effortMenu = await client.request<{ handled: true; output: string }>(
      "command/execute",
      { name: "effort", sessionId: first.session.id },
    );
    assert.equal(effortMenu.output.includes("choose effort:"), true);
    assert.equal(effortMenu.output.includes("2. * medium"), true);

    const effortSelected = await client.request<{
      handled: true;
      output: string;
    }>("command/execute", {
      name: "effort",
      args: "3",
      sessionId: first.session.id,
    });
    assert.equal(effortSelected.output.includes("effort: high"), true);

    const thinkMenu = await client.request<{ handled: true; output: string }>(
      "command/execute",
      { name: "think", sessionId: first.session.id },
    );
    assert.equal(thinkMenu.output.includes("choose think mode:"), true);
    assert.equal(thinkMenu.output.includes("1. * on"), true);

    const thinkSelected = await client.request<{
      handled: true;
      output: string;
    }>("command/execute", {
      name: "think",
      args: "2",
      sessionId: first.session.id,
    });
    assert.equal(thinkSelected.output.includes("think: off"), true);

    await client.request("command/execute", {
      name: "model",
      args: "1",
      sessionId: first.session.id,
    });
    const unsupportedEffort = await client.request<{
      handled: true;
      output: string;
    }>("command/execute", {
      name: "effort",
      sessionId: first.session.id,
    });
    assert.equal(
      unsupportedEffort.output,
      "model mock-a does not support effort",
    );
    const unsupportedThink = await client.request<{
      handled: true;
      output: string;
    }>("command/execute", {
      name: "think",
      sessionId: first.session.id,
    });
    assert.equal(
      unsupportedThink.output,
      "model mock-a does not support think",
    );
  } finally {
    client?.close();
    await server?.close().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
});

test("session server exposes account methods, client identity, and dashboard shell", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-session-accounts-"));
  const globalDir = join(root, "home", ".ndx");
  let server: SessionServer | undefined;
  let client: SessionClient | undefined;

  try {
    server = new SessionServer({
      cwd: root,
      config: {
        ...baseConfig,
        paths: { globalDir, dataDir: join(root, "data") },
      },
      sources: [join(globalDir, "settings.json")],
      createClient: () => new MockModelClient(),
    });
    const address = await server.listen(0, "127.0.0.1");
    const dashboard = await fetch(address.dashboardUrl ?? "");
    assert.equal(dashboard.status, 200);
    const html = await dashboard.text();
    assert.equal(html.includes('data-testid="ndx-dashboard"'), true);
    assert.equal(html.includes('aria-label="Server actions"'), true);
    assert.equal(html.includes(">Reload<"), true);
    assert.equal(html.includes(">Exit<"), true);
    assert.equal(html.includes("Version "), true);
    assert.equal(html.includes('role="status"'), true);

    client = await SessionClient.connect(address.url);
    assert.equal(await client.request("session/list"), null);
    const created = await client.request<{
      username: string;
    }>("account/create", {
      username: "alice",
      password: "secret",
    });
    assert.equal(created.username, "alice");
    const login = await client.request<{
      username: string;
      clientId: string;
      sessionRoot: string;
    }>("account/login", {
      username: "alice",
      password: "secret",
      clientId: "cli-run-1",
    });
    assert.deepEqual(login, {
      username: "alice",
      clientId: "cli-run-1",
      sessionRoot: join(root, "data"),
    });
    const start = await client.request<{
      session: { user: string; clientIds: string[] };
    }>("session/start", { cwd: root });
    assert.equal(start.session.user, "alice");
    assert.deepEqual(start.session.clientIds, ["cli-run-1"]);
    const changed = await client.request<{
      username: string;
    }>("account/changePassword", {
      username: "alice",
      oldPassword: "secret",
      newPassword: "changed",
    });
    assert.equal(changed.username, "alice");
  } finally {
    client?.close();
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("dashboard session logs filter raw SQLite events and delete sessions", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-dashboard-session-logs-"));
  const globalDir = join(root, "home", ".ndx");
  const projectA = join(root, "project-a");
  const projectB = join(root, "project-b");
  let server: SessionServer | undefined;
  let client: SessionClient | undefined;

  try {
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });
    server = new SessionServer({
      cwd: root,
      config: {
        ...baseConfig,
        paths: { globalDir, dataDir: join(root, "data") },
      },
      sources: [join(globalDir, "settings.json")],
      createClient: () => new MockModelClient(),
    });
    const address = await server.listen(0, "127.0.0.1");
    client = await SessionClient.connect(address.url);
    await client.request("account/create", {
      username: "alice",
      password: "secret",
    });
    await client.request("account/create", {
      username: "bob",
      password: "secret",
    });
    await client.request("account/login", {
      username: "alice",
      password: "secret",
      clientId: "dashboard-test-client",
    });
    const aliceA = await createPersistedSession(
      client,
      projectA,
      "alice project a prompt",
    );
    const aliceB = await createPersistedSession(
      client,
      projectB,
      "alice project b prompt",
    );
    await client.request("account/login", {
      username: "bob",
      password: "secret",
      clientId: "dashboard-test-client",
    });
    const bobB = await createPersistedSession(
      client,
      projectB,
      "bob project b prompt",
    );
    await server.flushPersistence();

    const dashboard = await fetch(address.dashboardUrl ?? "");
    const html = await dashboard.text();
    assert.equal(html.includes(">Session Logs<"), true);
    assert.equal(html.includes('data-testid="dashboard-session-logs"'), true);
    assert.equal(html.includes('data-testid="session-log-table"'), true);

    const facets = (await fetchJson(
      `${address.dashboardUrl}/api/session-log/facets`,
    )) as {
      accounts: string[];
      projects: string[];
      sessions: Array<{ id: string }>;
    };
    assert.deepEqual(facets.accounts, ["alice", "bob"]);
    const projectAId = readProjectId(projectA);
    const projectBId = readProjectId(projectB);
    assert.equal(facets.projects.includes(projectAId), true);
    assert.equal(facets.projects.includes(projectBId), true);
    assert.equal(facets.projects.includes(projectA), false);
    assert.equal(facets.sessions.length, 3);

    const aliceProjectLogs = (await fetchJson(
      `${address.dashboardUrl}/api/session-log/sessions?accounts=alice&projects=${encodeURIComponent(projectAId)}&projects=${encodeURIComponent(projectBId)}`,
    )) as { sessions: Array<{ id: string; user: string; cwd: string }> };
    assert.deepEqual(
      aliceProjectLogs.sessions.map((session) => session.id),
      [aliceA, aliceB],
    );
    assert.equal(
      aliceProjectLogs.sessions.every((session) => session.user === "alice"),
      true,
    );

    const selectedSessionLogs = (await fetchJson(
      `${address.dashboardUrl}/api/session-log/sessions?sessions=${encodeURIComponent(bobB)}`,
    )) as { sessions: Array<{ id: string; user: string; cwd: string }> };
    assert.deepEqual(
      selectedSessionLogs.sessions.map((session) => session.id),
      [bobB],
    );

    const firstPage = (await fetchJson(
      `${address.dashboardUrl}/api/session-log/sessions/${encodeURIComponent(aliceA)}/events?offset=0&limit=2`,
    )) as {
      total: number;
      events: Array<{ id: number; type: string; payload: unknown }>;
    };
    assert.equal(firstPage.total >= 2, true);
    assert.equal(firstPage.events.length, 2);
    assert.equal(firstPage.events[0]?.type, "session_started");
    assert.equal(typeof firstPage.events[0]?.payload, "object");

    const deleteResponse = (await fetchJson(
      `${address.dashboardUrl}/api/session-log/sessions/${encodeURIComponent(bobB)}`,
      { method: "DELETE" },
    )) as { ok: boolean; session: { id: string } };
    assert.equal(deleteResponse.ok, true);
    assert.equal(deleteResponse.session.id, bobB);

    const bobLogsAfterDelete = (await fetchJson(
      `${address.dashboardUrl}/api/session-log/sessions?accounts=bob`,
    )) as { sessions: Array<{ id: string }> };
    assert.deepEqual(bobLogsAfterDelete.sessions, []);
  } finally {
    client?.close();
    await server?.close().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
});

test("dashboard reload re-reads settings and AGENTS sources", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-dashboard-reload-"));
  const globalDir = join(root, "home", ".ndx");
  const projectNdxDir = join(root, ".ndx");
  let server: SessionServer | undefined;
  let client: SessionClient | undefined;

  try {
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(projectNdxDir, { recursive: true });
    writeFileSync(
      join(globalDir, "settings.json"),
      JSON.stringify(
        {
          model: "mock",
          providers: baseConfig.providers,
          models: baseConfig.models,
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(projectNdxDir, "settings.json"),
      JSON.stringify(
        {
          model: "mock-reloaded",
          providers: {
            mock: {
              type: "openai",
              key: "",
              url: "http://localhost/v1",
            },
          },
          models: [{ name: "mock-reloaded", provider: "mock" }],
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(root, "AGENTS.md"),
      "# Project Instructions\n\nUse test reload.\n",
    );
    server = new SessionServer({
      cwd: root,
      config: {
        ...baseConfig,
        paths: { globalDir, dataDir: join(root, "data") },
      },
      sources: [join(globalDir, "settings.json")],
      createClient: () => new MockModelClient(),
    });
    const address = await server.listen(0, "127.0.0.1");
    const reload = await fetch(`${address.dashboardUrl}/api/reload`, {
      method: "POST",
    });
    assert.equal(reload.status, 200);
    const body = (await reload.json()) as {
      ok?: boolean;
      sources?: string[];
    };
    assert.equal(body.ok, true);
    assert.equal(
      body.sources?.includes(join(projectNdxDir, "settings.json")),
      true,
    );
    assert.equal(body.sources?.includes(join(root, "AGENTS.md")), true);

    const dashboard = await fetch(address.dashboardUrl ?? "");
    const html = await dashboard.text();
    assert.equal(html.includes("mock-reloaded"), true);
    assert.equal(html.includes("AGENTS.md"), true);

    client = await SessionClient.connect(address.url);
    await loginClient(client);
    const started = await client.request<{
      session: { model: string };
    }>("session/start", { cwd: root });
    assert.equal(started.session.model, "mock-reloaded");
  } finally {
    client?.close();
    await server?.close().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
});

test("session server creates social login accounts", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-session-social-"));
  const globalDir = join(root, "home", ".ndx");
  let server: SessionServer | undefined;
  let client: SessionClient | undefined;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        sub: "google-subject-1",
        email: "user@example.test",
        name: "Example User",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    )) as typeof fetch;

  try {
    server = new SessionServer({
      cwd: root,
      config: {
        ...baseConfig,
        paths: { globalDir, dataDir: join(root, "data") },
      },
      sources: [join(globalDir, "settings.json")],
      createClient: () => new MockModelClient(),
    });
    const address = await server.listen(0, "127.0.0.1");
    client = await SessionClient.connect(address.url);
    const login = await client.request<{
      username: string;
      clientId: string;
      sessionRoot: string;
      provider: string;
      created: boolean;
    }>("account/socialLogin", {
      provider: "google",
      subject: "google-subject-1",
      accessToken: "token",
      clientId: "social-client-1",
    });

    assert.deepEqual(login, {
      username: "google:google-subject-1",
      clientId: "social-client-1",
      sessionRoot: join(root, "data"),
      provider: "google",
      created: true,
    });
    const start = await client.request<{
      session: { user: string; clientIds: string[] };
    }>("session/start", { cwd: root });
    assert.equal(start.session.user, "google:google-subject-1");
    assert.deepEqual(start.session.clientIds, ["social-client-1"]);
  } finally {
    globalThis.fetch = previousFetch;
    client?.close();
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session server restores a saved workspace session by id or number", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-session-restore-"));
  const globalDir = join(root, "home", ".ndx");
  const persistenceDir = join(root, "server-sessions");
  const restoredModel = new CapturingModelClient("restored context ok");
  let firstServer: SessionServer | undefined;
  let secondServer: SessionServer | undefined;
  let firstClient: SessionClient | undefined;
  let secondClient: SessionClient | undefined;

  try {
    writeShellTool(join(globalDir, "system", "tools", "shell"));
    firstServer = new SessionServer({
      cwd: root,
      config: { ...baseConfig, paths: { globalDir } },
      sources: [join(globalDir, "settings.json")],
      createClient: () => new MockModelClient(),
      persistenceDir,
    });
    const firstAddress = await firstServer.listen(0, "127.0.0.1");
    firstClient = await SessionClient.connect(firstAddress.url);
    await initializeAndLoginClient(firstClient);
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
      createClient: () => restoredModel,
      persistenceDir,
    });
    const secondAddress = await secondServer.listen(0, "127.0.0.1");
    secondClient = await SessionClient.connect(secondAddress.url);
    await initializeAndLoginClient(secondClient);

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

    assert.ok(Array.isArray(restoredModel.inputs[0]));
    assert.deepEqual(
      (restoredModel.inputs[0] as Array<{ content?: string }>)
        .map((item) => item.content)
        .filter((content): content is string => content !== undefined),
      ["first turn", "mock agent completed", "second turn"],
    );

    const records = readSqliteRecords(persistenceDir, originalSessionId);
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

test("session lite mode prunes previous tool logs when a new user turn starts", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-session-lite-"));
  const globalDir = join(root, "home", ".ndx");
  const persistenceDir = join(root, "server-sessions");
  const model = new ScriptedToolModelClient(["first answer", "second answer"]);
  let server: SessionServer | undefined;
  let client: SessionClient | undefined;

  try {
    writeShellTool(join(globalDir, "system", "tools", "shell"));
    server = new SessionServer({
      cwd: root,
      config: {
        ...baseConfig,
        activeModel: { ...baseConfig.activeModel, maxContext: 1 },
        models: [{ name: "mock", provider: "mock", maxContext: 1 }],
        paths: { globalDir },
      },
      sources: [join(globalDir, "settings.json")],
      createClient: () => model,
      persistenceDir,
    });
    client = await SessionClient.connect(
      (await server.listen(0, "127.0.0.1")).url,
    );
    await initializeAndLoginClient(client);
    const start = await client.request<{ session: { id: string } }>(
      "session/start",
      { cwd: root },
    );
    const sessionId = start.session.id;

    const firstCompleted = waitForMethod(client, "turn/completed");
    await client.request("turn/start", { sessionId, prompt: "first turn" });
    await firstCompleted;
    await server.flushPersistence();

    const enabled = await client.request<{ handled: true; output: string }>(
      "command/execute",
      { name: "lite", args: "on", sessionId },
    );
    assert.equal(enabled.output.includes("lite: on"), true);
    assert.equal(enabled.output.includes("before"), true);
    assert.equal(enabled.output.includes("after"), true);
    const activeContext = await client.request<{ handled: true; output: string }>(
      "command/execute",
      { name: "context", sessionId },
    );
    assert.equal(activeContext.output.includes("assistant_tool_calls"), true);
    assert.equal(activeContext.output.includes("tool_results"), true);
    const rejected = await client.request<{ handled: true; output: string }>(
      "command/execute",
      { name: "lite", args: "off", sessionId },
    );
    assert.equal(rejected.output.includes("lite: still on"), true);
    assert.equal(rejected.output.includes("before"), true);
    assert.equal(rejected.output.includes("after"), true);

    const secondCompleted = waitForMethod(client, "turn/completed");
    await client.request("turn/start", { sessionId, prompt: "second turn" });
    await secondCompleted;
    await server.flushPersistence();

    const secondInput = model.inputs[2];
    assert.ok(Array.isArray(secondInput));
    assert.deepEqual(
      secondInput.map((item) => (item as { type?: string }).type),
      ["message", "message", "message"],
    );
    assert.deepEqual(
      (secondInput as Array<{ content?: string }>)
        .map((item) => item.content)
        .filter((content): content is string => content !== undefined),
      ["first turn", "first answer", "second turn"],
    );

    const contextEvents = readSqliteContextEvents(persistenceDir, sessionId);
    assert.equal(
      contextEvents.some((event) => event.type === "tool_call"),
      true,
    );
    assert.equal(
      contextEvents.some((event) => event.type === "tool_result"),
      true,
    );
    const tables = readSqliteTableNames(persistenceDir);
    assert.equal(
      tables.some((table) => table.startsWith("session_context")),
      false,
    );
    assert.equal(readSqliteContextEvents(persistenceDir, sessionId).length, contextEvents.length);
  } finally {
    client?.close();
    await server?.close().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
});

test("session lite mode prunes failed prior turn tool logs on next user request", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-session-lite-failed-"));
  const globalDir = join(root, "home", ".ndx");
  const persistenceDir = join(root, "server-sessions");
  const model = new MaxTurnsThenTextModelClient("second answer");
  let server: SessionServer | undefined;
  let client: SessionClient | undefined;

  try {
    writeShellTool(join(globalDir, "system", "tools", "shell"));
    server = new SessionServer({
      cwd: root,
      config: {
        ...baseConfig,
        maxTurns: 1,
        paths: { globalDir },
      },
      sources: [join(globalDir, "settings.json")],
      createClient: () => model,
      persistenceDir,
    });
    client = await SessionClient.connect(
      (await server.listen(0, "127.0.0.1")).url,
    );
    await initializeAndLoginClient(client);
    const start = await client.request<{ session: { id: string } }>(
      "session/start",
      { cwd: root },
    );
    const sessionId = start.session.id;

    const firstFailed = waitForMethod(client, "error");
    await client.request("turn/start", {
      sessionId,
      prompt: "first failed turn",
    });
    await firstFailed;
    await server.flushPersistence();

    const enabled = await client.request<{ handled: true; output: string }>(
      "command/execute",
      { name: "lite", args: "on", sessionId },
    );
    assert.equal(enabled.output.includes("lite: on"), true);

    const secondCompleted = waitForMethod(client, "turn/completed");
    await client.request("turn/start", { sessionId, prompt: "second turn" });
    await secondCompleted;
    await server.flushPersistence();

    const secondInput = model.inputs[1];
    assert.ok(Array.isArray(secondInput));
    assert.deepEqual(
      secondInput.map((item) => (item as { type?: string }).type),
      ["message", "message"],
    );
    assert.deepEqual(
      (secondInput as Array<{ content?: string }>)
        .map((item) => item.content)
        .filter((content): content is string => content !== undefined),
      ["first failed turn", "second turn"],
    );
  } finally {
    client?.close();
    await server?.close().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
});

test("session compact stores a summary record and restarts model context there", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-session-compact-"));
  const globalDir = join(root, "home", ".ndx");
  const persistenceDir = join(root, "server-sessions");
  const model = new ScriptedToolModelClient(["first answer", "second answer"]);
  let server: SessionServer | undefined;
  let client: SessionClient | undefined;

  try {
    writeShellTool(join(globalDir, "system", "tools", "shell"));
    server = new SessionServer({
      cwd: root,
      config: { ...baseConfig, paths: { globalDir } },
      sources: [join(globalDir, "settings.json")],
      createClient: () => model,
      persistenceDir,
    });
    client = await SessionClient.connect(
      (await server.listen(0, "127.0.0.1")).url,
    );
    await initializeAndLoginClient(client);
    const start = await client.request<{ session: { id: string } }>(
      "session/start",
      { cwd: root },
    );
    const sessionId = start.session.id;

    const firstCompleted = waitForMethod(client, "turn/completed");
    await client.request("turn/start", { sessionId, prompt: "first turn" });
    await firstCompleted;
    await server.flushPersistence();

    const compacted = await client.request<{ handled: true; output: string }>(
      "command/execute",
      { name: "compact", sessionId },
    );
    assert.equal(compacted.output.includes("compact: created"), true);

    const secondCompleted = waitForMethod(client, "turn/completed");
    await client.request("turn/start", { sessionId, prompt: "second turn" });
    await secondCompleted;
    await server.flushPersistence();

    const secondInput = model.inputs[2];
    assert.ok(Array.isArray(secondInput));
    assert.deepEqual(
      secondInput.map((item) => (item as { type?: string }).type),
      ["message", "message"],
    );
    const contents = (secondInput as Array<{ content?: string }>)
      .map((item) => item.content)
      .filter((content): content is string => content !== undefined);
    assert.equal(contents.length, 2);
    assert.equal(contents[0]?.includes("Earlier conversation summary"), true);
    assert.equal(contents[0]?.includes("first turn"), true);
    assert.equal(contents[0]?.includes("first answer"), true);
    assert.equal(contents[1], "second turn");

    const records = readSqliteRecords(persistenceDir, sessionId);
    assert.equal(
      records.some((record) => record.type === "context_compact"),
      true,
    );
  } finally {
    client?.close();
    await server?.close().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
});

test("session server deletes non-current workspace sessions and ends stale owners", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-session-delete-"));
  const globalDir = join(root, "home", ".ndx");
  const persistenceDir = join(root, "server-sessions");
  let firstServer: SessionServer | undefined;
  let secondServer: SessionServer | undefined;
  let firstClient: SessionClient | undefined;
  let secondClient: SessionClient | undefined;

  try {
    writeShellTool(join(globalDir, "system", "tools", "shell"));
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
    await initializeAndLoginClientAs(firstClient, "first-owner-client");
    await initializeAndLoginClientAs(secondClient, "second-owner-client");

    const startResponse = await firstClient.request<{
      session: { id: string };
    }>("session/start", { cwd: root });
    const sessionId = startResponse.session.id;
    const completed = waitForMethod(firstClient, "turn/completed");
    await firstClient.request("turn/start", {
      sessionId,
      prompt: "delete me later",
    });
    await completed;
    await firstServer.flushPersistence();

    const candidates = await secondClient.request<{
      sessions: Array<{ number: number; id: string }>;
    }>("session/deleteCandidates", { cwd: root });
    assert.deepEqual(
      candidates.sessions.map((session) => session.id),
      [sessionId],
    );

    const deleteResponse = await secondClient.request<{
      message: string;
    }>("session/delete", { cwd: root, selector: "1" });
    assert.equal(deleteResponse.message, "deleted session 1: delete me later");
    assert.equal(existsSync(sessionLogFile(persistenceDir, sessionId)), false);

    const deleted = waitForMethod(firstClient, "session/deleted");
    await firstClient
      .request("turn/start", {
        sessionId,
        prompt: "prompt after delete",
      })
      .catch((error: unknown) => {
        assert.equal(
          error instanceof Error && error.message.includes("closed"),
          true,
        );
      });
    const notification = await deleted;
    assert.equal(notification.method, "session/deleted");
  } finally {
    firstClient?.close();
    secondClient?.close();
    await firstServer?.close().catch(() => undefined);
    await secondServer?.close().catch(() => undefined);
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
    writeShellTool(join(globalDir, "system", "tools", "shell"));
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
    await initializeAndLoginClientAs(firstClient, "first-owner-client");
    await initializeAndLoginClientAs(secondClient, "second-owner-client");

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

    const records = readSqliteRecords(persistenceDir, sessionId);
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

test("session ownership discards in-flight output from a previous socket server", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-session-owner-race-"));
  const globalDir = join(root, "home", ".ndx");
  const persistenceDir = join(root, "server-sessions");
  const firstModel = new BlockingModelClient();
  let firstServer: SessionServer | undefined;
  let secondServer: SessionServer | undefined;
  let firstClient: SessionClient | undefined;
  let secondClient: SessionClient | undefined;

  try {
    writeShellTool(join(globalDir, "system", "tools", "shell"));
    firstServer = new SessionServer({
      cwd: root,
      config: { ...baseConfig, paths: { globalDir } },
      sources: [join(globalDir, "settings.json")],
      createClient: () => firstModel,
      persistenceDir,
    });
    secondServer = new SessionServer({
      cwd: root,
      config: { ...baseConfig, paths: { globalDir } },
      sources: [join(globalDir, "settings.json")],
      createClient: () => new MockModelClient(),
      persistenceDir,
    });
    firstClient = await withTimeout(
      SessionClient.connect((await firstServer.listen(0, "127.0.0.1")).url),
      "connecting first race client",
    );
    secondClient = await withTimeout(
      SessionClient.connect((await secondServer.listen(0, "127.0.0.1")).url),
      "connecting second race client",
    );
    await withTimeout(
      initializeAndLoginClientAs(firstClient, "first-owner-client"),
      "initializing first race client",
    );
    await withTimeout(
      initializeAndLoginClientAs(secondClient, "second-owner-client"),
      "initializing second race client",
    );

    const startResponse = await withTimeout(
      firstClient.request<{
        session: { id: string };
      }>("session/start", { cwd: root }),
      "starting race session",
    );
    const sessionId = startResponse.session.id;
    const initialCompleted = waitForMethod(firstClient, "turn/completed");
    await withTimeout(
      firstClient.request("turn/start", {
        sessionId,
        prompt: "initial persisted prompt",
      }),
      "starting initial race turn",
    );
    await withTimeout(initialCompleted, "waiting for initial race completion");
    await withTimeout(
      firstServer.flushPersistence(),
      "flushing initial race turn",
    );

    const blockedTurnStarted = waitForMethod(firstClient, "turn/started");
    await withTimeout(
      firstClient.request("turn/start", {
        sessionId,
        prompt: "stale in flight prompt",
      }),
      "starting blocked stale turn",
    );
    await withTimeout(
      blockedTurnStarted,
      "waiting for blocked stale turn start",
    );
    await withTimeout(
      firstModel.waitForBlockedTurn(),
      "waiting for blocking model client",
    );

    await withTimeout(
      secondClient.request("session/restore", { cwd: root, selector: "1" }),
      "restoring session on second server",
    );
    await withTimeout(
      secondServer.flushPersistence(),
      "flushing second server",
    );

    const ownershipChanged = waitForMethod(
      firstClient,
      "session/ownershipChanged",
    );
    firstModel.releaseBlockedTurn();
    await withTimeout(ownershipChanged, "waiting for stale owner notification");
    await withTimeout(firstServer.flushPersistence(), "flushing first server");

    const records = readSqliteRecords(persistenceDir, sessionId);
    const runtimeMessages = records
      .filter((record) => record.type === "runtime_event")
      .map((record) => (record.event as { msg?: unknown }).msg)
      .filter((msg): msg is Record<string, unknown> => typeof msg === "object");
    assert.equal(
      runtimeMessages.some(
        (msg) =>
          msg.type === "agent_message" && msg.text === "stale in-flight output",
      ),
      false,
    );
    assert.equal(
      runtimeMessages.some(
        (msg) =>
          msg.type === "turn_complete" &&
          msg.finalText === "stale in-flight output",
      ),
      false,
    );

    const readResponse = await withTimeout(
      firstClient.request<{
        events: Array<{
          msg: { type: string; text?: string; finalText?: string };
        }>;
      }>("session/read", { sessionId }),
      "reading stale owner session events",
    );
    assert.equal(
      readResponse.events.some(
        (event) =>
          event.msg.text === "stale in-flight output" ||
          event.msg.finalText === "stale in-flight output",
      ),
      false,
    );
  } finally {
    firstModel.releaseBlockedTurn();
    firstClient?.close();
    secondClient?.close();
    await firstServer?.close();
    await secondServer?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session ownership is tracked in SQLite across socket servers", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-session-owner-lock-"));
  const globalDir = join(root, "home", ".ndx");
  const persistenceDir = join(root, "server-sessions");
  let firstServer: SessionServer | undefined;
  let secondServer: SessionServer | undefined;
  let firstClient: SessionClient | undefined;
  let secondClient: SessionClient | undefined;
  let lockReleaser: ChildProcess | undefined;

  try {
    writeShellTool(join(globalDir, "system", "tools", "shell"));
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
    await initializeAndLoginClientAs(firstClient, "first-owner-client");
    await initializeAndLoginClientAs(secondClient, "second-owner-client");

    const startResponse = await firstClient.request<{
      session: { id: string };
    }>("session/start", { cwd: root });
    const sessionId = startResponse.session.id;
    const completed = waitForMethod(firstClient, "turn/completed");
    await firstClient.request("turn/start", {
      sessionId,
      prompt: "persist before lock contention",
    });
    await completed;
    await firstServer.flushPersistence();

    const restoreResponse = await secondClient.request<{
      session: { id: string; sequence: number };
    }>("session/restore", { cwd: root, selector: "1" });

    assert.equal(restoreResponse.session.id, sessionId);
    assert.equal(
      readSqliteOwner(persistenceDir, sessionId) !== undefined,
      true,
    );
  } finally {
    if (lockReleaser !== undefined) {
      lockReleaser.kill();
      await waitForProcess(lockReleaser).catch(() => undefined);
    }
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

async function createPersistedSession(
  client: SessionClient,
  cwd: string,
  prompt: string,
): Promise<string> {
  const started = await client.request<{
    session: { id: string };
  }>("session/start", { cwd });
  const completed = waitForMethod(client, "turn/completed");
  await client.request("turn/start", {
    sessionId: started.session.id,
    prompt,
  });
  await completed;
  return started.session.id;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const body = await response.json();
  assert.equal(response.ok, true);
  return body;
}

async function initializeAndLoginClient(client: SessionClient): Promise<void> {
  await initializeAndLoginClientAs(client, "test-client");
}

async function initializeAndLoginClientAs(
  client: SessionClient,
  clientId: string,
): Promise<void> {
  await loginClientAs(client, clientId);
  await client.request("initialize");
}

async function loginClient(client: SessionClient): Promise<void> {
  await loginClientAs(client, "test-client");
}

async function loginClientAs(
  client: SessionClient,
  clientId: string,
): Promise<void> {
  await client.request("account/login", {
    username: "defaultUser",
    password: "",
    clientId,
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

async function waitForSqliteRecord(
  dataDir: string,
  sessionId: string,
  predicate: (record: Record<string, unknown>) => boolean,
): Promise<Array<Record<string, unknown>>> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const records = readSqliteRecords(dataDir, sessionId);
    if (records.some(predicate)) {
      return records;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`timed out waiting for sqlite record for ${sessionId}`);
}

function readSqliteRecords(
  dataDir: string,
  sessionId: string,
): Array<Record<string, unknown>> {
  const require = createRequire(import.meta.url);
  const sqlite = require("node:sqlite") as {
    DatabaseSync: new (
      path: string,
      options?: { readOnly?: boolean },
    ) => {
      prepare(sql: string): { all(...values: unknown[]): unknown[] };
      close(): void;
    };
  };
  const db = new sqlite.DatabaseSync(join(dataDir, "ndx.sqlite"), {
    readOnly: true,
  });
  try {
    return db
      .prepare(
        [
          "select d.payload_json as payload",
          "from sessiondata d join session s on s.rowid = d.sessionrowid",
          "where s.sessionid = ?",
          "order by d.rowid asc",
        ].join(" "),
      )
      .all(sessionId)
      .map((row) => JSON.parse((row as { payload: string }).payload));
  } finally {
    db.close();
  }
}

function readSqliteSessionProjection(
  dataDir: string,
  sessionId: string,
): { eventCount: number; lastEventId?: number } | undefined {
  const require = createRequire(import.meta.url);
  const sqlite = require("node:sqlite") as {
    DatabaseSync: new (
      path: string,
      options?: { readOnly?: boolean },
    ) => {
      prepare(sql: string): { get(...values: unknown[]): unknown };
      close(): void;
    };
  };
  const db = new sqlite.DatabaseSync(join(dataDir, "ndx.sqlite"), {
    readOnly: true,
  });
  try {
    const row = db
      .prepare(
        "select eventcount as eventCount, lastdatarowid as lastEventId from session where sessionid = ?",
      )
      .get(sessionId) as
      | { eventCount?: unknown; lastEventId?: unknown }
      | undefined;
    if (typeof row?.eventCount !== "number") {
      return undefined;
    }
    return {
      eventCount: row.eventCount,
      lastEventId:
        typeof row.lastEventId === "number" ? row.lastEventId : undefined,
    };
  } finally {
    db.close();
  }
}

function readSqliteSessionMeta(
  dataDir: string,
  sessionId: string,
):
  | {
      rowid: number;
      sessionid: string;
      created: number;
      userid: string;
      projectid: string;
      path: string;
      islite: number;
      ownerid?: string;
      lastlogin: number;
    }
  | undefined {
  const require = createRequire(import.meta.url);
  const sqlite = require("node:sqlite") as {
    DatabaseSync: new (
      path: string,
      options?: { readOnly?: boolean },
    ) => {
      prepare(sql: string): { get(...values: unknown[]): unknown };
      close(): void;
    };
  };
  const db = new sqlite.DatabaseSync(join(dataDir, "ndx.sqlite"), {
    readOnly: true,
  });
  try {
    const row = db
      .prepare(
        [
          "select rowid, sessionid, created, userid, projectid, path, islite, ownerid, lastlogin",
          "from session where sessionid = ?",
        ].join(" "),
      )
      .get(sessionId) as
      | {
          rowid?: unknown;
          sessionid?: unknown;
          created?: unknown;
          userid?: unknown;
          projectid?: unknown;
          path?: unknown;
          islite?: unknown;
          ownerid?: unknown;
          lastlogin?: unknown;
        }
      | undefined;
    if (
      typeof row?.rowid !== "number" ||
      typeof row.sessionid !== "string" ||
      typeof row.created !== "number" ||
      typeof row.userid !== "string" ||
      typeof row.projectid !== "string" ||
      typeof row.path !== "string" ||
      typeof row.islite !== "number" ||
      typeof row.lastlogin !== "number"
    ) {
      return undefined;
    }
    return {
      rowid: row.rowid,
      sessionid: row.sessionid,
      created: row.created,
      userid: row.userid,
      projectid: row.projectid,
      path: row.path,
      islite: row.islite,
      ownerid: typeof row.ownerid === "string" ? row.ownerid : undefined,
      lastlogin: row.lastlogin,
    };
  } finally {
    db.close();
  }
}

function readSqliteSessionData(
  dataDir: string,
  sessionId: string,
): Array<{ type: string; sessionrowid: number; ownerid?: string }> {
  const require = createRequire(import.meta.url);
  const sqlite = require("node:sqlite") as {
    DatabaseSync: new (
      path: string,
      options?: { readOnly?: boolean },
    ) => {
      prepare(sql: string): { all(...values: unknown[]): unknown[] };
      close(): void;
    };
  };
  const db = new sqlite.DatabaseSync(join(dataDir, "ndx.sqlite"), {
    readOnly: true,
  });
  try {
    return db
      .prepare(
        [
          "select d.type, d.sessionrowid, d.ownerid",
          "from sessiondata d join session s on s.rowid = d.sessionrowid",
          "where s.sessionid = ?",
          "order by d.rowid asc",
        ].join(" "),
      )
      .all(sessionId)
      .map((row) => {
        const typed = row as {
          type?: unknown;
          sessionrowid?: unknown;
          ownerid?: unknown;
        };
        return {
          type: String(typed.type),
          sessionrowid:
            typeof typed.sessionrowid === "number" ? typed.sessionrowid : 0,
          ownerid:
            typeof typed.ownerid === "string" ? typed.ownerid : undefined,
        };
      });
  } finally {
    db.close();
  }
}

function readProjectId(cwd: string): string {
  const parsed = JSON.parse(readFileSync(join(cwd, ".ndx", ".project"), "utf8")) as {
    projectid?: unknown;
  };
  assert.equal(typeof parsed.projectid, "string");
  return String(parsed.projectid);
}

function readSqliteContextEvents(
  dataDir: string,
  sessionId: string,
): Array<{ type: string }> {
  const require = createRequire(import.meta.url);
  const sqlite = require("node:sqlite") as {
    DatabaseSync: new (
      path: string,
      options?: { readOnly?: boolean },
    ) => {
      prepare(sql: string): { all(...values: unknown[]): unknown[] };
      close(): void;
    };
  };
  const db = new sqlite.DatabaseSync(join(dataDir, "ndx.sqlite"), {
    readOnly: true,
  });
  try {
    return db
      .prepare(
        [
          "select d.payload_json as payload",
          "from sessiondata d join session s on s.rowid = d.sessionrowid",
          "where s.sessionid = ? and d.iscontext = 1",
          "order by d.rowid asc",
        ].join(" "),
      )
      .all(sessionId)
      .map((row) => JSON.parse((row as { payload: string }).payload))
      .map((record) => ({
        type: String(
          (record as { event?: { msg?: { type?: unknown } } }).event?.msg
            ?.type,
        ),
      }));
  } finally {
    db.close();
  }
}

function readSqliteTableNames(dataDir: string): string[] {
  const require = createRequire(import.meta.url);
  const sqlite = require("node:sqlite") as {
    DatabaseSync: new (
      path: string,
      options?: { readOnly?: boolean },
    ) => {
      prepare(sql: string): { all(...values: unknown[]): unknown[] };
      close(): void;
    };
  };
  const db = new sqlite.DatabaseSync(join(dataDir, "ndx.sqlite"), {
    readOnly: true,
  });
  try {
    return db
      .prepare(
        "select name from sqlite_master where type = 'table' order by name asc",
      )
      .all()
      .map((row) => (row as { name?: unknown }).name)
      .filter(
        (name): name is string => typeof name === "string",
      );
  } finally {
    db.close();
  }
}

function readSqliteOwner(
  dataDir: string,
  sessionId: string,
): string | undefined {
  const require = createRequire(import.meta.url);
  const sqlite = require("node:sqlite") as {
    DatabaseSync: new (
      path: string,
      options?: { readOnly?: boolean },
    ) => {
      prepare(sql: string): { get(...values: unknown[]): unknown };
      close(): void;
    };
  };
  const db = new sqlite.DatabaseSync(join(dataDir, "ndx.sqlite"), {
    readOnly: true,
  });
  try {
    const row = db
      .prepare(
        "select ownerid from session where sessionid = ?",
      )
      .get(sessionId) as { ownerid?: unknown } | undefined;
    return typeof row?.ownerid === "string" ? row.ownerid : undefined;
  } finally {
    db.close();
  }
}

function readJsonl(file: string): Array<Record<string, unknown>> {
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function sessionLogFile(root: string, sessionId: string): string {
  const found = sessionLogFiles(root).find(
    (file) => basename(file, ".jsonl") === sessionId,
  );
  return (
    found ??
    join(root, "defaultUser", "unknown", "unknown", `${sessionId}.jsonl`)
  );
}

function sessionLogFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return sessionLogFiles(path);
    }
    return entry.isFile() && entry.name.endsWith(".jsonl") ? [path] : [];
  });
}

function waitForProcess(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) {
    return Promise.resolve(child.exitCode);
  }
  if (child.signalCode !== null) {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  ms = 2_000,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out ${label}`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
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

class BlockingModelClient implements ModelClient {
  private releaseBlocked:
    | ((response: ModelResponse | PromiseLike<ModelResponse>) => void)
    | undefined;
  private blockedTurn:
    | {
        promise: Promise<void>;
        resolve: () => void;
      }
    | undefined;

  async create(input: unknown): Promise<ModelResponse> {
    if (containsText(input, "stale in flight prompt")) {
      return new Promise<ModelResponse>((resolve) => {
        this.releaseBlocked = resolve;
        this.blockedTurn?.resolve();
      });
    }
    return {
      id: "blocking-initial",
      text: "initial persisted output",
      toolCalls: [],
      raw: { input },
    };
  }

  releaseBlockedTurn(): void {
    this.releaseBlocked?.({
      id: "blocking-stale",
      text: "stale in-flight output",
      toolCalls: [],
      raw: { blocked: true },
    });
    this.releaseBlocked = undefined;
  }

  waitForBlockedTurn(): Promise<void> {
    if (this.releaseBlocked !== undefined) {
      return Promise.resolve();
    }
    if (this.blockedTurn === undefined) {
      this.blockedTurn = createDeferred<void>();
    }
    return this.blockedTurn.promise;
  }
}

function containsText(value: unknown, expected: string): boolean {
  if (typeof value === "string") {
    return value.includes(expected);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsText(entry, expected));
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).some((entry) => containsText(entry, expected));
  }
  return false;
}

function createDeferred<T>(): { promise: Promise<T>; resolve: () => void } {
  let resolveDeferred: () => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = () => resolve(undefined as T);
  });
  return { promise, resolve: resolveDeferred };
}

class CapturingModelClient implements ModelClient {
  readonly inputs: unknown[] = [];

  constructor(private readonly text: string) {}

  async create(input: unknown): Promise<ModelResponse> {
    this.inputs.push(input);
    return {
      id: `captured-${this.inputs.length}`,
      text: this.text,
      toolCalls: [],
      raw: { input },
    };
  }
}

class ScriptedToolModelClient implements ModelClient {
  readonly inputs: Array<Array<unknown>> = [];
  private step = 0;

  constructor(private readonly texts: string[]) {}

  async create(input: unknown): Promise<ModelResponse> {
    this.inputs.push(Array.isArray(input) ? input : [input]);
    this.step += 1;
    if (this.step === 1) {
      return {
        id: "scripted-tool-call",
        text: "",
        toolCalls: [
          {
            callId: "scripted-call-1",
            name: "shell",
            arguments: JSON.stringify({ command: "printf scripted-tool" }),
          },
        ],
        raw: { input },
      };
    }
    return {
      id: `scripted-text-${this.step}`,
      text: this.texts.shift() ?? "done",
      toolCalls: [],
      raw: { input },
    };
  }
}

class MaxTurnsThenTextModelClient implements ModelClient {
  readonly inputs: Array<Array<unknown>> = [];
  private step = 0;

  constructor(private readonly text: string) {}

  async create(input: unknown): Promise<ModelResponse> {
    this.inputs.push(Array.isArray(input) ? input : [input]);
    this.step += 1;
    if (this.step === 1) {
      return {
        id: "max-turns-tool-call",
        text: "",
        toolCalls: [
          {
            callId: "max-turns-call-1",
            name: "shell",
            arguments: JSON.stringify({ command: "printf max-turns" }),
          },
        ],
        raw: { input },
      };
    }
    return {
      id: `max-turns-text-${this.step}`,
      text: this.text,
      toolCalls: [],
      raw: { input },
    };
  }
}
