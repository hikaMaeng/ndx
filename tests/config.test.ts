import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  configFiles,
  ensureGlobalNdxHome,
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
    assert.deepEqual(loaded.config.modelPools, {
      session: ["project-model"],
      worker: [],
      reviewer: [],
      custom: {},
    });
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

test("loadConfig accepts model pools for session, worker, and reviewer", () => {
  const root = tempRoot();
  try {
    const globalDir = join(root, "home", ".ndx");
    const project = join(root, "repo");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(project, { recursive: true });

    writeJson(join(globalDir, "settings.json"), {
      model: {
        session: ["session-a", "session-b"],
        worker: ["worker-a", "worker-b"],
        reviewer: "reviewer-a",
        custom: {
          deep: ["reviewer-a", "session-b"],
          fast: "session-a",
        },
      },
      providers: {
        provider: {
          type: "openai",
          key: "",
          url: "http://provider.example/v1",
        },
      },
      models: [
        { name: "session-a", provider: "provider" },
        { name: "session-b", provider: "provider" },
        { name: "worker-a", provider: "provider" },
        { name: "worker-b", provider: "provider" },
        { name: "reviewer-a", provider: "provider" },
      ],
    });

    const loaded = loadConfig(project, { globalDir });

    assert.equal(loaded.config.model, "session-a");
    assert.deepEqual(loaded.config.modelPools, {
      session: ["session-a", "session-b"],
      worker: ["worker-a", "worker-b"],
      reviewer: ["reviewer-a"],
      custom: {
        deep: ["reviewer-a", "session-b"],
        fast: ["session-a"],
      },
    });
    assert.equal(loaded.config.activeModel.name, "session-a");
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

test("loadConfig fails when no global or project settings exist", () => {
  const root = tempRoot();
  try {
    const globalDir = join(root, "home", ".ndx");
    const project = join(root, "repo");
    mkdirSync(project, { recursive: true });

    assert.throws(
      () => loadConfig(project, { globalDir }),
      /missing ndx settings: expected .*settings\.json/,
    );
    assert.equal(existsSync(join(globalDir, "settings.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ensureGlobalNdxHome installs core directories and tool packages", () => {
  const root = tempRoot();
  try {
    const globalDir = join(root, "home", ".ndx");
    const report = ensureGlobalNdxHome(globalDir);

    assert.equal(existsSync(join(globalDir, "settings.json")), false);
    assert.equal(existsSync(join(globalDir, "core")), true);
    assert.equal(existsSync(join(globalDir, "skills")), true);
    assert.equal(
      existsSync(join(globalDir, "core", "tools", "shell", "tool.json")),
      true,
    );
    assert.equal(
      existsSync(join(globalDir, "core", "tools", "shell", "tool.mjs")),
      true,
    );
    for (const tool of [
      "apply_patch",
      "list_dir",
      "view_image",
      "web_search",
      "image_generation",
      "tool_suggest",
      "tool_search",
      "request_permissions",
    ]) {
      assert.equal(
        existsSync(join(globalDir, "core", "tools", tool, "tool.json")),
        true,
      );
      assert.equal(
        existsSync(join(globalDir, "core", "tools", tool, "tool.mjs")),
        true,
      );
    }
    assert.equal(report.globalDir, globalDir);
    assert.equal(
      report.elements.some(
        (element) =>
          element.name === "core list_dir manifest" &&
          element.status === "installed",
      ),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ensureGlobalNdxHome reports existing required elements on later runs", () => {
  const root = tempRoot();
  try {
    const globalDir = join(root, "home", ".ndx");
    ensureGlobalNdxHome(globalDir);
    const report = ensureGlobalNdxHome(globalDir);

    assert.equal(
      report.elements.every((element) => element.status === "existing"),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
