import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  configFiles,
  loadConfig,
  resolveGlobalNdxDir,
} from "../src/config/index.js";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "ndx-config-"));
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

test("resolveGlobalNdxDir returns /home/.ndx by default", () => {
  assert.equal(resolveGlobalNdxDir(), "/home/.ndx");
  assert.equal(
    resolveGlobalNdxDir({ globalDir: "/tmp/global" }),
    "/tmp/global",
  );
});

test("loadConfig cascades global settings, nearest project settings, and global search rules", () => {
  const root = tempRoot();
  try {
    const globalDir = join(root, "home", ".ndx");
    const project = join(root, "repo");
    const child = join(project, "child");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(join(project, ".ndx"), { recursive: true });
    mkdirSync(child, { recursive: true });

    writeJson(join(globalDir, "settings.json"), {
      model: "global-model",
      providers: {
        lmstudio: {
          type: "openai",
          key: "",
          url: "http://global.example/v1",
        },
      },
      models: [
        {
          name: "global-model",
          provider: "lmstudio",
          maxContext: 100,
        },
      ],
      keys: {
        A: "1",
        B: "global",
      },
      shellTimeoutMs: 111,
    });
    writeJson(join(globalDir, "search.json"), {
      provider: "tavily",
      response: {
        resultsPath: "results",
      },
    });
    writeJson(join(project, ".ndx", "settings.json"), {
      model: "project-model",
      providers: {
        lmstudio: {
          type: "openai",
          key: "project-key",
          url: "http://project.example/v1",
        },
      },
      models: [
        {
          name: "project-model",
          provider: "lmstudio",
          maxContext: 200,
        },
      ],
      keys: {
        B: "project",
      },
      env: {
        C: "3",
      },
      permissions: {
        defaultMode: "danger-full-access",
      },
    });

    const loaded = loadConfig(child, { globalDir });
    assert.equal(loaded.config.model, "project-model");
    assert.equal(loaded.config.activeProvider.key, "project-key");
    assert.equal(loaded.config.activeProvider.url, "http://project.example/v1");
    assert.deepEqual(loaded.config.env, { A: "1", B: "project", C: "3" });
    assert.equal(loaded.config.shellTimeoutMs, 111);
    assert.deepEqual(loaded.config.search, {
      provider: "tavily",
      response: {
        resultsPath: "results",
      },
    });
    assert.equal(loaded.sources.length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("configFiles returns only global and nearest project settings", () => {
  const root = tempRoot();
  try {
    const globalDir = join(root, "home", ".ndx");
    const project = join(root, "repo");
    const nested = join(project, "nested", "child");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(join(project, ".ndx"), { recursive: true });
    mkdirSync(nested, { recursive: true });
    writeJson(join(project, ".ndx", "settings.json"), {});

    assert.deepEqual(configFiles(nested, { globalDir }), [
      join(globalDir, "settings.json"),
      join(project, ".ndx", "settings.json"),
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
