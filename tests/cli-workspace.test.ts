import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockModelClient } from "../src/model/mock-client.js";
import { SessionServer } from "../src/session/server.js";
import {
  dockerSandboxState,
  hostPathToSandboxPath,
} from "../src/session/docker-sandbox.js";
import type { NdxConfig } from "../src/shared/types.js";
import {
  ensureManagedServer,
  normalizeSocketUrl,
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

test("server address argument defaults to localhost port 45123", () => {
  assert.equal(normalizeSocketUrl(undefined), "ws://127.0.0.1:45123");
  assert.equal(normalizeSocketUrl("127.0.0.1"), "ws://127.0.0.1:45123");
  assert.equal(normalizeSocketUrl("127.0.0.1:55123"), "ws://127.0.0.1:55123");
  assert.equal(normalizeSocketUrl("ws://127.0.0.1"), "ws://127.0.0.1:45123");
});

test("managed server fallback reports current project sandbox metadata", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "ndx-project-"));
  const previousImage = process.env.NDX_SANDBOX_IMAGE;
  process.env.NDX_SANDBOX_IMAGE = "hika00/ndx-sandbox:test";
  try {
    const state = await ensureManagedServer({
      cwd: projectDir,
      serverUrl: "127.0.0.1:9",
      print: () => undefined,
    });

    assert.equal(state.projectDir, projectDir);
    assert.equal(state.socketUrl, "ws://127.0.0.1:9");
    assert.equal(state.image, "hika00/ndx-sandbox:test");
    assert.equal(state.reachable, false);
  } finally {
    if (previousImage === undefined) {
      delete process.env.NDX_SANDBOX_IMAGE;
    } else {
      process.env.NDX_SANDBOX_IMAGE = previousImage;
    }
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("managed server attaches to the requested socket before Docker fallback", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "ndx-project-"));
  const globalDir = join(projectDir, "home", ".ndx");
  let server: SessionServer | undefined;
  try {
    server = new SessionServer({
      cwd: projectDir,
      config: { ...baseConfig, paths: { globalDir } },
      sources: [],
      createClient: () => new MockModelClient(),
      persistenceDir: join(projectDir, "data"),
    });
    const address = await server.listen(0, "127.0.0.1");
    const state = await ensureManagedServer({
      cwd: projectDir,
      serverUrl: address.url,
      print: () => undefined,
    });

    assert.equal(state.socketUrl, address.url);
    assert.equal(state.reachable, true);
  } finally {
    await server?.close();
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("docker sandbox state is stable per workspace and maps host paths", () => {
  const state = dockerSandboxState({
    workspaceDir: "/tmp/project-a",
    globalDir: "/tmp/home/.ndx",
    image: "hika00/ndx-sandbox:test",
  });

  assert.equal(state.image, "hika00/ndx-sandbox:test");
  assert.equal(state.containerName, "ndx-tool-project-a");
  assert.equal(state.globalDir, "/tmp/home/.ndx");
  assert.equal(state.containerGlobalDir, "/home/.ndx");
  assert.equal(hostPathToSandboxPath(state, "/tmp/project-a"), "/workspace");
  assert.equal(
    hostPathToSandboxPath(state, "/tmp/project-a/src/index.ts"),
    "/workspace/src/index.ts",
  );
  assert.equal(hostPathToSandboxPath(state, "/tmp/other"), "/workspace");
});
