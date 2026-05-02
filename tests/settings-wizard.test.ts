import {
  mkdirSync,
  readFileSync,
  rmSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createGlobalSettingsWithWizard,
  repairSettingsWithWizard,
} from "../src/cli/settings-wizard.js";
import { currentSettingsVersion, loadConfig } from "../src/config/index.js";

test("settings wizard creates global settings that loadConfig can read", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-settings-wizard-"));
  const globalDir = join(root, "home", ".ndx");
  const answers = [
    "2",
    "1",
    "",
    "http://127.0.0.1:12345/v1",
    "local-model",
    "262000",
  ];
  const printed: string[] = [];
  try {
    const settingsFile = await createGlobalSettingsWithWizard(globalDir, {
      question: async () => answers.shift() ?? "",
      print: (message) => printed.push(message),
    });
    const settings = JSON.parse(readFileSync(settingsFile, "utf8")) as {
      model?: string;
      version?: string;
      permissions?: { defaultMode?: string };
      providers?: { default?: { type?: string; key?: string; url?: string } };
      models?: Array<{ name?: string; maxContext?: number }>;
    };

    assert.equal(settings.model, "local-model");
    assert.equal(settings.version, currentSettingsVersion());
    assert.equal(settings.permissions?.defaultMode, "workspace-write");
    assert.equal(settings.providers?.default?.type, "openai");
    assert.equal(settings.providers?.default?.key, "");
    assert.equal(settings.providers?.default?.url, "http://127.0.0.1:12345/v1");
    assert.equal(settings.models?.[0]?.name, "local-model");
    assert.equal(settings.models?.[0]?.maxContext, 262000);
    assert.equal(
      printed.some((line) => line.includes("creating project settings")),
      false,
    );
    assert.equal(
      printed.some((line) => line.includes("creating global settings")),
      true,
    );

    const loaded = loadConfig(root, { globalDir });
    assert.equal(loaded.config.model, "local-model");
    assert.equal(loaded.config.activeProvider.url, "http://127.0.0.1:12345/v1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("settings wizard repairs global settings before project settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-settings-repair-"));
  const globalDir = join(root, "home", ".ndx");
  const projectNdxDir = join(root, ".ndx");
  const answers = [
    "global-model",
    "",
    "1",
    "",
    "http://127.0.0.1:12345/v1",
    "262000",
    "",
    "1",
    "",
    "http://127.0.0.1:12346/v1",
    "128000",
  ];
  const printed: string[] = [];
  try {
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(projectNdxDir, { recursive: true });
    writeFileSync(
      join(globalDir, "settings.json"),
      `${JSON.stringify({ version: "0.0.1" }, null, 2)}\n`,
    );
    writeFileSync(
      join(projectNdxDir, "settings.json"),
      `${JSON.stringify({ model: "project-model" }, null, 2)}\n`,
    );

    const repaired = await repairSettingsWithWizard(
      root,
      {
        question: async () => answers.shift() ?? "",
        print: (message) => printed.push(message),
      },
      globalDir,
    );

    assert.deepEqual(repaired, [
      join(globalDir, "settings.json"),
      join(projectNdxDir, "settings.json"),
    ]);
    assert.equal(printed.some((line) => line.includes("provider type")), true);

    const globalSettings = JSON.parse(
      readFileSync(join(globalDir, "settings.json"), "utf8"),
    ) as { version?: string; model?: string };
    const projectSettings = JSON.parse(
      readFileSync(join(projectNdxDir, "settings.json"), "utf8"),
    ) as { version?: string; model?: string };

    assert.equal(globalSettings.version, currentSettingsVersion());
    assert.equal(globalSettings.model, "global-model");
    assert.equal(projectSettings.version, currentSettingsVersion());
    assert.equal(projectSettings.model, "project-model");

    const loaded = loadConfig(root, { globalDir });
    assert.equal(loaded.config.model, "project-model");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
