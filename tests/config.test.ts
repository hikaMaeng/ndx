import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { configFiles, loadConfig, resolveNdxHome } from "../src/config.js";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "ndx-config-"));
}

test("resolveNdxHome prefers NDX_HOME and otherwise uses /home/ndx/.ndx", () => {
  assert.equal(resolveNdxHome({ NDX_HOME: "/tmp/custom" }), "/tmp/custom");
  assert.equal(resolveNdxHome({}), "/home/ndx/.ndx");
});

test("loadConfig cascades global and project .ndx config with env merge", () => {
  const root = tempRoot();
  try {
    const home = join(root, "home", ".ndx");
    const project = join(root, "repo");
    const child = join(project, "child");
    mkdirSync(home, { recursive: true });
    mkdirSync(join(project, ".ndx"), { recursive: true });
    mkdirSync(join(child, ".ndx"), { recursive: true });
    writeFileSync(
      join(home, "config.toml"),
      'model = "global"\n[env]\nA = "1"\nB = "global"\n',
    );
    writeFileSync(
      join(project, ".ndx", "config.toml"),
      'instructions = "project"\n[env]\nB = "project"\n',
    );
    writeFileSync(
      join(child, ".ndx", "config.toml"),
      'model = "child"\nshell_timeout_ms = 42\n[env]\nC = "3"\n',
    );

    const loaded = loadConfig(child, { NDX_HOME: home });
    assert.equal(loaded.config.model, "child");
    assert.equal(loaded.config.instructions, "project");
    assert.equal(loaded.config.shellTimeoutMs, 42);
    assert.deepEqual(loaded.config.env, { A: "1", B: "project", C: "3" });
    assert.equal(loaded.sources.length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("configFiles returns global then project ancestors", () => {
  const files = configFiles("/tmp/a/b", { NDX_HOME: "/home/ndx/.ndx" });
  assert.equal(files[0], "/home/ndx/.ndx/config.toml");
  assert(files.includes("/tmp/a/.ndx/config.toml"));
  assert(files.includes("/tmp/a/b/.ndx/config.toml"));
});
