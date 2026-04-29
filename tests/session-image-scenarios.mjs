import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockModelClient } from "/opt/ndx/dist/src/model/mock-client.js";
import { SessionClient } from "/opt/ndx/dist/src/session/client.js";
import { SessionServer } from "/opt/ndx/dist/src/session/server.js";

const baseConfig = {
  model: "mock",
  instructions: "docker session validation",
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
  paths: { globalDir: "/tmp/unused" },
};

async function runDeleteRestoreScenario() {
  const root = mkdtempSync(join(tmpdir(), "ndx-image-delete-restore-"));
  const globalDir = join(root, "home", ".ndx");
  const persistenceDir = join(root, "server-sessions");
  let firstServer;
  let secondServer;
  let firstClient;
  let secondClient;
  try {
    firstServer = new SessionServer({
      cwd: root,
      config: { ...baseConfig, paths: { globalDir } },
      sources: [join(globalDir, "settings.json")],
      createClient: () => new MockModelClient(),
      persistenceDir,
    });
    firstClient = await SessionClient.connect(
      (await firstServer.listen(0, "127.0.0.1")).url,
    );
    await firstClient.request("initialize");

    const alpha = await createPersistedSession(
      firstClient,
      firstServer,
      root,
      "alpha restore baseline",
    );
    const beta = await createPersistedSession(
      firstClient,
      firstServer,
      root,
      "beta delete target",
    );
    const gamma = await createPersistedSession(
      firstClient,
      firstServer,
      root,
      "gamma remaining session",
    );

    const initialList = await firstClient.request("session/list", {
      cwd: root,
    });
    assert.deepEqual(
      initialList.sessions.map((session) => session.number),
      [1, 2, 3],
    );
    assert.equal(initialList.sessions[0].id, alpha);
    assert.equal(initialList.sessions[1].id, beta);
    assert.equal(initialList.sessions[2].id, gamma);

    secondServer = new SessionServer({
      cwd: root,
      config: { ...baseConfig, paths: { globalDir } },
      sources: [join(globalDir, "settings.json")],
      createClient: () => new MockModelClient(),
      persistenceDir,
    });
    secondClient = await SessionClient.connect(
      (await secondServer.listen(0, "127.0.0.1")).url,
    );
    await secondClient.request("initialize");

    const restored = await secondClient.request("session/restore", {
      cwd: root,
      selector: "1",
    });
    assert.equal(restored.session.id, alpha);
    assert.equal(sessionNumber(restored.session), 1);
    await secondServer.flushPersistence();

    const restoredRead = await secondClient.request("session/read", {
      sessionId: alpha,
    });
    assert.ok(
      restoredRead.events.length > 0,
      "restored session has persisted runtime events",
    );

    const candidates = await secondClient.request("session/deleteCandidates", {
      cwd: root,
      currentSessionId: alpha,
    });
    assert.deepEqual(
      candidates.sessions.map((session) => session.number),
      [2, 3],
    );

    const deleted = await secondClient.request("session/delete", {
      cwd: root,
      selector: "2",
      currentSessionId: alpha,
    });
    assert.equal(deleted.session.id, beta);
    assert.equal(existsSync(join(persistenceDir, `${beta}.jsonl`)), false);
    assert.equal(existsSync(join(persistenceDir, `${alpha}.jsonl`)), true);
    assert.equal(existsSync(join(persistenceDir, `${gamma}.jsonl`)), true);

    const staleDeleted = waitForMethod(firstClient, "session/deleted");
    await firstClient
      .request("turn/start", {
        sessionId: beta,
        prompt: "prompt on deleted beta",
        cwd: root,
      })
      .catch(() => undefined);
    const staleNotification = await withTimeout(
      staleDeleted,
      "stale owner delete notification",
    );
    assert.equal(staleNotification.method, "session/deleted");

    const afterDelete = await secondClient.request("session/list", {
      cwd: root,
    });
    assert.deepEqual(
      afterDelete.sessions.map((session) => session.number),
      [1, 3],
    );

    return {
      createdNumbers: initialList.sessions.map((session) => session.number),
      restoredNumber: sessionNumber(restored.session),
      deleteCandidates: candidates.sessions.map((session) => session.number),
      remainingNumbers: afterDelete.sessions.map((session) => session.number),
      staleDeleteNotification: staleNotification.method,
    };
  } finally {
    firstClient?.close();
    secondClient?.close();
    await firstServer?.close().catch(() => undefined);
    await secondServer?.close().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
}

async function runReplacementScenario() {
  const root = mkdtempSync(join(tmpdir(), "ndx-image-replace-"));
  const globalDir = join(root, "home", ".ndx");
  const persistenceDir = join(root, "server-sessions");
  const firstModel = new BlockingModelClient();
  let firstServer;
  let secondServer;
  let firstClient;
  let secondClient;
  try {
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
    firstClient = await SessionClient.connect(
      (await firstServer.listen(0, "127.0.0.1")).url,
    );
    secondClient = await SessionClient.connect(
      (await secondServer.listen(0, "127.0.0.1")).url,
    );
    await firstClient.request("initialize");
    await secondClient.request("initialize");

    const sessionId = await createPersistedSession(
      firstClient,
      firstServer,
      root,
      "middle replacement seed",
    );

    const blockedStarted = waitForMethod(firstClient, "turn/started");
    await firstClient.request("turn/start", {
      sessionId,
      prompt: "middle turn should be replaced",
      cwd: root,
    });
    await withTimeout(blockedStarted, "blocked turn started");
    await withTimeout(
      firstModel.waitForBlockedTurn(),
      "blocking model engaged",
    );

    const restored = await secondClient.request("session/restore", {
      cwd: root,
      selector: "1",
    });
    assert.equal(restored.session.id, sessionId);
    await secondServer.flushPersistence();

    const ownershipChanged = waitForMethod(
      firstClient,
      "session/ownershipChanged",
    );
    firstModel.releaseBlockedTurn();
    await withTimeout(ownershipChanged, "ownership changed notification");
    await firstServer.flushPersistence();

    const records = readJsonl(join(persistenceDir, `${sessionId}.jsonl`));
    const stalePersisted = records.some((record) =>
      JSON.stringify(record).includes("stale output after replacement"),
    );
    assert.equal(stalePersisted, false);

    const secondCompleted = waitForMethod(secondClient, "turn/completed");
    await secondClient.request("turn/start", {
      sessionId,
      prompt: "replacement owner final prompt",
      cwd: root,
    });
    await withTimeout(secondCompleted, "replacement owner completion");
    await secondServer.flushPersistence();

    return {
      restoredNumber: sessionNumber(restored.session),
      staleOutputPersisted: stalePersisted,
      ownerCanContinue: true,
    };
  } finally {
    firstModel.releaseBlockedTurn();
    firstClient?.close();
    secondClient?.close();
    await firstServer?.close().catch(() => undefined);
    await secondServer?.close().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
}

async function createPersistedSession(client, server, root, prompt) {
  const started = await client.request("session/start", { cwd: root });
  const sessionId = started.session.id;
  const completed = waitForMethod(client, "turn/completed");
  await client.request("turn/start", { sessionId, prompt, cwd: root });
  await withTimeout(completed, `completion for ${prompt}`, 5_000);
  await server.flushPersistence();
  return sessionId;
}

function waitForMethod(client, method) {
  return new Promise((resolve) => {
    const off = client.onNotification((notification) => {
      if (notification.method === method) {
        off();
        resolve(notification);
      }
    });
  });
}

async function withTimeout(promise, label, ms = 3_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out: ${label}`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function readJsonl(file) {
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function sessionNumber(session) {
  return session.number ?? session.sequence;
}

class BlockingModelClient {
  releaseBlocked;
  blockedTurn;

  async create(input) {
    if (containsText(input, "middle turn should be replaced")) {
      return new Promise((resolve) => {
        this.releaseBlocked = resolve;
        this.blockedTurn?.resolve();
      });
    }
    return {
      id: "blocking-normal",
      text: "normal output",
      toolCalls: [],
      raw: { input },
    };
  }

  releaseBlockedTurn() {
    this.releaseBlocked?.({
      id: "blocking-stale",
      text: "stale output after replacement",
      toolCalls: [],
      raw: { stale: true },
    });
    this.releaseBlocked = undefined;
  }

  waitForBlockedTurn() {
    if (this.releaseBlocked !== undefined) {
      return Promise.resolve();
    }
    if (this.blockedTurn === undefined) {
      let resolve;
      const promise = new Promise((innerResolve) => {
        resolve = innerResolve;
      });
      this.blockedTurn = { promise, resolve };
    }
    return this.blockedTurn.promise;
  }
}

function containsText(value, expected) {
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

const deletion = await runDeleteRestoreScenario();
const replacement = await runReplacementScenario();

console.log(
  JSON.stringify(
    {
      ok: true,
      deletion,
      replacement,
    },
    null,
    2,
  ),
);
