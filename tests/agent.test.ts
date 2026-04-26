import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../src/agent.js";
import { MockModelClient } from "../src/mock-client.js";
import type { NdxConfig } from "../src/types.js";

const baseConfig: NdxConfig = {
  model: "mock",
  instructions: "test",
  env: {},
  maxTurns: 4,
  shellTimeoutMs: 30_000,
};

test("mock agent exercises shell tool and completes", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-agent-"));
  try {
    const target = join(root, "tmp", "verify.txt");
    const result = await runAgent({
      cwd: root,
      config: baseConfig,
      client: new MockModelClient(),
      prompt: `create a file named ${target} with text verified`,
    });
    assert.equal(result, "mock agent completed");
    assert.equal(existsSync(target), true);
    assert.equal(readFileSync(target, "utf8"), "verified");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
