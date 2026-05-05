import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  configFiles,
  currentSettingsVersion,
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

function writeSkill(path: string, name: string, description: string): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      "---",
      "",
      `Use ${name} carefully.`,
      "",
    ].join("\n"),
  );
}

test("resolveGlobalNdxDir returns user home .ndx by default", () => {
  assert.equal(resolveGlobalNdxDir(), join(homedir(), ".ndx"));
  assert.equal(
    resolveGlobalNdxDir({ globalDir: "/tmp/global" }),
    "/tmp/global",
  );
});

test("loadConfig cascades global settings, current project settings, and global search rules", () => {
  const root = tempRoot();
  try {
    const globalDir = join(root, "home", ".ndx");
    const project = join(root, "repo");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(join(project, ".ndx"), { recursive: true });

    writeJson(join(globalDir, "settings.json"), {
      model: "global-model",
      sessionPath: join(root, "custom-sessions"),
      providers: {
        localOpenAi: {
          type: "openai",
          key: "",
          url: "http://global.example/v1",
        },
      },
      models: [
        {
          name: "global-model",
          provider: "localOpenAi",
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
        localOpenAi: {
          type: "openai",
          key: "project-key",
          url: "http://project.example/v1",
        },
      },
      models: [
        {
          name: "project-model",
          provider: "localOpenAi",
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

    const loaded = loadConfig(project, { globalDir });
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
    assert.equal(loaded.config.paths.sessionDir, join(root, "custom-sessions"));
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

test("loadConfig cascades project and user AGENTS.md in fixed source order", () => {
  const root = tempRoot();
  try {
    const globalDir = join(root, "home", ".ndx");
    const project = join(root, "repo");
    const nested = join(project, "packages", "agent");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(join(project, ".git"), { recursive: true });
    mkdirSync(nested, { recursive: true });

    writeJson(join(globalDir, "settings.json"), {
      model: "mock",
      providers: {
        mock: { type: "openai", key: "", url: "http://mock.example/v1" },
      },
      models: [{ name: "mock", provider: "mock" }],
    });
    writeFileSync(join(globalDir, "AGENTS.md"), "user home\n");
    writeFileSync(join(project, "AGENTS.md"), "project root\n");
    mkdirSync(join(project, ".ndx"), { recursive: true });
    writeFileSync(join(project, ".ndx", "AGENTS.md"), "project ndx\n");
    writeFileSync(join(nested, "AGENTS.md"), "nested ignored\n");

    const loaded = loadConfig(nested, { globalDir });

    assert.equal(loaded.config.instructions.includes("user home"), true);
    assert.equal(loaded.config.instructions.includes("project root"), true);
    assert.equal(loaded.config.instructions.includes("project ndx"), true);
    assert.equal(loaded.config.instructions.includes("nested ignored"), false);
    assert.deepEqual(
      loaded.sources.filter((source) => source.endsWith("AGENTS.md")),
      [
        join(project, "AGENTS.md"),
        join(project, ".ndx", "AGENTS.md"),
        join(globalDir, "AGENTS.md"),
      ],
    );
    assert.deepEqual(
      loaded.config.contextSources?.map((source) => source.origin),
      ["project", "project", "user"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadConfig applies max byte budget to fixed AGENTS.md cascade", () => {
  const root = tempRoot();
  try {
    const globalDir = join(root, "home", ".ndx");
    const project = join(root, "repo");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(join(project, ".git"), { recursive: true });
    writeJson(join(globalDir, "settings.json"), {
      model: "mock",
      providers: {
        mock: { type: "openai", key: "", url: "http://mock.example/v1" },
      },
      models: [{ name: "mock", provider: "mock" }],
      projectDocMaxBytes: 8,
    });
    writeFileSync(join(project, "AGENTS.md"), "project instructions");
    writeFileSync(join(globalDir, "AGENTS.md"), "user instructions");

    const loaded = loadConfig(project, { globalDir });

    assert.equal(loaded.config.instructions.includes("project"), true);
    assert.equal(
      loaded.config.instructions.includes("project instructions"),
      false,
    );
    assert.equal(loaded.sources.includes(join(project, "AGENTS.md")), true);
    assert.equal(loaded.sources.includes(join(globalDir, "AGENTS.md")), false);
    assert.equal(loaded.config.projectDocs?.maxBytes, 8);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadConfig discovers skills from fixed project, plugin, user, and system roots", () => {
  const root = tempRoot();
  try {
    const globalDir = join(root, "home", ".ndx");
    const project = join(root, "repo");
    const nested = join(project, "nested");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(join(project, ".git"), { recursive: true });
    mkdirSync(nested, { recursive: true });
    writeJson(join(globalDir, "settings.json"), {
      model: "mock",
      providers: {
        mock: { type: "openai", key: "", url: "http://mock.example/v1" },
      },
      models: [{ name: "mock", provider: "mock" }],
    });
    writeSkill(
      join(globalDir, "skills", "user-tool"),
      "user-tool",
      "Global user skill",
    );
    writeSkill(
      join(globalDir, "plugins", "user-plugin", "skills", "user-plugin-tool"),
      "user-plugin-tool",
      "Global plugin skill",
    );
    writeSkill(
      join(globalDir, "system", "skills", "system-tool"),
      "system-tool",
      "Bundled system skill",
    );
    writeSkill(
      join(globalDir, "skills", ".system", "ignored-system-tool"),
      "ignored-system-tool",
      "Ignored legacy system skill",
    );
    writeSkill(
      join(project, ".ndx", "skills", "project-tool"),
      "project-tool",
      "Project skill",
    );
    writeSkill(
      join(
        project,
        ".ndx",
        "plugins",
        "project-plugin",
        "skills",
        "project-plugin-tool",
      ),
      "project-plugin-tool",
      "Project plugin skill",
    );
    writeSkill(
      join(nested, ".ndx", "skills", "nested-tool"),
      "nested-tool",
      "Nested skill ignored outside project root",
    );

    const loaded = loadConfig(nested, { globalDir });
    const skills = loaded.config.skills?.skills ?? [];

    assert.deepEqual(
      skills.map((skill) => `${skill.scope}:${skill.name}`),
      [
        "repo:project-plugin-tool",
        "repo:project-tool",
        "user:user-plugin-tool",
        "user:user-tool",
        "system:system-tool",
      ],
    );
    assert.equal(
      loaded.config.instructions.includes("- project-tool: Project skill"),
      true,
    );
    assert.equal(
      loaded.sources.some((source) => source.endsWith("project-tool/SKILL.md")),
      true,
    );
    assert.equal(
      loaded.sources.some((source) =>
        source.endsWith("ignored-system-tool/SKILL.md"),
      ),
      false,
    );
    assert.deepEqual(
      loaded.config.contextSources
        ?.filter((source) => source.kind === "skills")
        .map((source) => source.origin),
      ["project", "project", "user", "user", "user"],
    );
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

test("loadConfig accepts object model catalog entries with aliases and runtime options", () => {
  const root = tempRoot();
  try {
    const globalDir = join(root, "home", ".ndx");
    const project = join(root, "repo");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(project, { recursive: true });

    writeJson(join(globalDir, "settings.json"), {
      model: {
        session: ["fast-local", "deep-local"],
      },
      providers: {
        localOpenAi: {
          type: "openai",
          key: "",
          url: "http://provider.example/v1",
        },
      },
      models: {
        "fast-local": {
          name: "local-model-high",
          provider: "localOpenAi",
          maxContext: 262000,
          effort: ["low", "medium", "high"],
          think: true,
          limitResponseLength: 2048,
          temperature: 0.2,
          topK: 40,
          repeatPenalty: 1.05,
          presencePenalty: 0.1,
          topP: 0.9,
          MinP: 0.05,
        },
        "deep-local": {
          name: "local-model-high",
          provider: "localOpenAi",
          effort: ["high"],
          think: true,
        },
      },
    });

    const loaded = loadConfig(project, { globalDir });

    assert.equal(loaded.config.model, "fast-local");
    assert.equal(loaded.config.activeModel.id, "fast-local");
    assert.equal(loaded.config.activeModel.name, "local-model-high");
    assert.equal(loaded.config.activeModel.activeEffort, "medium");
    assert.equal(loaded.config.activeModel.activeThink, true);
    assert.equal(loaded.config.activeModel.limitResponseLength, 2048);
    assert.equal(loaded.config.activeModel.temperature, 0.2);
    assert.deepEqual(loaded.config.modelPools.session, [
      "fast-local",
      "deep-local",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadConfig silently updates settings versions when content is otherwise valid", () => {
  const root = tempRoot();
  try {
    const globalDir = join(root, "home", ".ndx");
    const project = join(root, "repo");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(join(project, ".ndx"), { recursive: true });
    const globalSettings = join(globalDir, "settings.json");
    const projectSettings = join(project, ".ndx", "settings.json");

    writeJson(globalSettings, {
      version: "0.0.1",
      model: "global-model",
      providers: {
        localOpenAi: {
          type: "openai",
          key: "",
          url: "http://global.example/v1",
        },
      },
      models: [
        {
          name: "global-model",
          provider: "localOpenAi",
          maxContext: 100,
        },
      ],
    });
    writeJson(projectSettings, {
      model: "project-model",
      providers: {
        localOpenAi: {
          type: "openai",
          key: "",
          url: "http://project.example/v1",
        },
      },
      models: [
        {
          name: "project-model",
          provider: "localOpenAi",
          maxContext: 200,
        },
      ],
    });

    const loaded = loadConfig(project, { globalDir });
    assert.equal(loaded.config.model, "project-model");
    assert.equal(
      JSON.parse(readFileSync(globalSettings, "utf8")).version,
      currentSettingsVersion(),
    );
    assert.equal(
      JSON.parse(readFileSync(projectSettings, "utf8")).version,
      currentSettingsVersion(),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("configFiles returns only global and current project settings", () => {
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
    ]);
    assert.deepEqual(configFiles(project, { globalDir }), [
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

test("ensureGlobalNdxHome installs system directories and tool packages", () => {
  const root = tempRoot();
  try {
    const globalDir = join(root, "home", ".ndx");
    const report = ensureGlobalNdxHome(globalDir);

    assert.equal(existsSync(join(globalDir, "settings.json")), false);
    assert.equal(existsSync(join(globalDir, "system", "tools")), true);
    assert.equal(existsSync(join(globalDir, "system", "core")), false);
    assert.equal(existsSync(join(globalDir, "system", "skills")), true);
    assert.equal(
      existsSync(join(globalDir, "system", "tools", "shell", "tool.json")),
      true,
    );
    assert.equal(
      existsSync(join(globalDir, "system", "tools", "shell", "tool.mjs")),
      true,
    );
    assert.deepEqual(
      JSON.parse(
        readFileSync(
          join(globalDir, "system", "tools", "shell", "tool.json"),
          "utf8",
        ),
      ).requirements,
      {
        apt: ["bash"],
        binaries: ["bash"],
      },
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
        existsSync(join(globalDir, "system", "tools", tool, "tool.json")),
        true,
      );
      assert.equal(
        existsSync(join(globalDir, "system", "tools", tool, "tool.mjs")),
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
      false,
    );
    assert.equal(
      report.elements.some(
        (element) =>
          element.name === "list_dir manifest" &&
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
