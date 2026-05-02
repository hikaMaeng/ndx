import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createGlobalSettingsWithWizard } from "../src/cli/settings-wizard.js";
import { loadConfig } from "../src/config/index.js";

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
      permissions?: { defaultMode?: string };
      providers?: { default?: { type?: string; key?: string; url?: string } };
      models?: Array<{ name?: string; maxContext?: number }>;
    };

    assert.equal(settings.model, "local-model");
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
