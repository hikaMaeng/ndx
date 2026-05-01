import test from "node:test";
import assert from "node:assert/strict";
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
import { MockModelClient } from "../src/model/mock-client.js";
import { SessionServer } from "../src/session/server.js";
import type { NdxConfig } from "../src/shared/types.js";
import {
  ensureWorkspaceServer,
  type WorkspaceState,
  workspaceStateFile,
} from "../src/cli/workspace.js";

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

test("workspace bootstrap creates compose state without using .ndx for CLI login", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-workspace-"));
  const stateDir = mkdtempSync(join(tmpdir(), "ndx-cli-state-"));
  const previousState = process.env.NDX_CLI_STATE_DIR;
  const previousImage = process.env.NDX_DOCKER_IMAGE;
  process.env.NDX_CLI_STATE_DIR = stateDir;
  process.env.NDX_DOCKER_IMAGE = "ndx-agent:test";
  try {
    const state = await ensureWorkspaceServer({
      cwd: root,
      manageDocker: false,
      print: () => undefined,
    });

    assert.equal(state.root, root);
    assert.equal(state.image, "ndx-agent:test");
    assert.equal(state.mock, true);
    assert.equal(existsSync(state.composeFile), true);
    assert.equal(existsSync(workspaceStateFile(root)), true);
    assert.equal(existsSync(join(root, ".ndx", "settings.json")), true);
    const compose = readFileSync(state.composeFile, "utf8");
    assert.equal(compose.includes("ndxserver"), true);
    assert.equal(compose.includes("--mock"), true);
    assert.equal(compose.includes(`${state.socketPort}:45123`), true);
    assert.equal(compose.includes(`${root}`), true);
    assert.equal(
      workspaceStateFile(root).startsWith(join(stateDir, "workspaces")),
      true,
    );
  } finally {
    if (previousState === undefined) {
      delete process.env.NDX_CLI_STATE_DIR;
    } else {
      process.env.NDX_CLI_STATE_DIR = previousState;
    }
    if (previousImage === undefined) {
      delete process.env.NDX_DOCKER_IMAGE;
    } else {
      process.env.NDX_DOCKER_IMAGE = previousImage;
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("workspace bootstrap finds a live socket state before trying Docker", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-workspace-"));
  const stateDir = mkdtempSync(join(tmpdir(), "ndx-cli-state-"));
  const globalDir = join(root, "home", ".ndx");
  const previousState = process.env.NDX_CLI_STATE_DIR;
  process.env.NDX_CLI_STATE_DIR = stateDir;
  let server: SessionServer | undefined;
  try {
    server = new SessionServer({
      cwd: root,
      config: { ...baseConfig, paths: { globalDir } },
      sources: [],
      createClient: () => new MockModelClient(),
      persistenceDir: join(root, "data"),
    });
    const address = await server.listen(0, "127.0.0.1");
    const livePort = Number(new URL(address.url).port);
    const staleState = workspaceState(root, "ws://127.0.0.1:9", 9);
    const liveState = workspaceState(root, address.url, livePort);

    mkdirSync(join(stateDir, "workspaces"), { recursive: true });
    writeFileSync(
      workspaceStateFile(root),
      `${JSON.stringify(staleState, null, 2)}\n`,
    );
    writeFileSync(
      join(stateDir, "workspaces", "alternate-live.json"),
      `${JSON.stringify(liveState, null, 2)}\n`,
    );

    const state = await ensureWorkspaceServer({
      cwd: root,
      print: () => undefined,
    });

    assert.equal(state.socketUrl, address.url);
    assert.equal(state.socketPort, livePort);
  } finally {
    await server?.close();
    if (previousState === undefined) {
      delete process.env.NDX_CLI_STATE_DIR;
    } else {
      process.env.NDX_CLI_STATE_DIR = previousState;
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  }
});

function workspaceState(
  root: string,
  socketUrl: string,
  socketPort: number,
): WorkspaceState {
  return {
    root,
    composeFile: join(root, ".ndx", "managed", "docker-compose.yml"),
    socketUrl,
    dashboardUrl: "http://127.0.0.1:45124",
    socketPort,
    dashboardPort: 45124,
    image: "ndx-agent:test",
    mock: true,
    updatedAt: Date.now(),
  };
}
