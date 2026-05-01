import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockModelClient } from "../src/model/mock-client.js";
import { SessionServer } from "../src/session/server.js";
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

test("managed server bootstrap writes project-path compose fallback", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "ndx-project-"));
  const previousImage = process.env.NDX_DOCKER_IMAGE;
  process.env.NDX_DOCKER_IMAGE = "ndx-agent:test";
  try {
    const state = await ensureManagedServer({
      cwd: projectDir,
      serverUrl: "127.0.0.1:9",
      manageDocker: false,
      print: () => undefined,
    });

    assert.equal(state.workspaceDir, projectDir);
    assert.equal(state.socketUrl, "ws://127.0.0.1:9");
    assert.equal(state.image, "ndx-agent:test");
    assert.equal(existsSync(state.composeFile), true);
    const compose = readFileSync(state.composeFile, "utf8");
    assert.equal(compose.includes("ndxserver"), true);
    assert.equal(compose.includes("--mock"), true);
    assert.equal(compose.includes(projectDir), true);
    assert.equal(compose.includes("target: /workspace"), true);
    assert.equal(compose.includes("/var/run/docker.sock"), true);
    assert.equal(compose.includes(state.homeDir), true);
    assert.equal(compose.includes("target: /home/.ndx"), true);
  } finally {
    if (previousImage === undefined) {
      delete process.env.NDX_DOCKER_IMAGE;
    } else {
      process.env.NDX_DOCKER_IMAGE = previousImage;
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
    assert.equal(existsSync(state.composeFile), false);
  } finally {
    await server?.close();
    rmSync(projectDir, { recursive: true, force: true });
  }
});
