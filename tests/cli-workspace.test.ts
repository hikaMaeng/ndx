import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureWorkspaceServer,
  workspaceStateFile,
} from "../src/cli/workspace.js";

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
