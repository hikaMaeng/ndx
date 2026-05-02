import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  configFiles,
  currentSettingsVersion,
  resolveGlobalNdxDir,
} from "../config/index.js";
import type { JsonObject } from "../shared/types.js";

const PERMISSION_OPTIONS = [
  {
    label: "danger-full-access",
    description: "no sandbox restrictions",
  },
  {
    label: "workspace-write",
    description: "workspace write access",
  },
  {
    label: "read-only",
    description: "read-only access",
  },
] as const;

const PROVIDER_TYPES = ["openai", "anthropic"] as const;

export interface SettingsWizardIo {
  question(prompt: string): Promise<string>;
  print(message: string): void;
}

export async function createGlobalSettingsWithWizard(
  globalDir: string,
  io: SettingsWizardIo,
): Promise<string> {
  const ndxDir = resolve(globalDir);
  const settingsFile = join(ndxDir, "settings.json");

  io.print("ndx settings were not found.");
  io.print(`creating global settings at ${settingsFile}`);

  const permission = await chooseOption(
    io,
    "permission",
    PERMISSION_OPTIONS.map((option) => option.label),
    PERMISSION_OPTIONS.map((option) => option.description),
  );
  const providerType = await chooseOption(
    io,
    "provider type",
    [...PROVIDER_TYPES],
    ["OpenAI-compatible Responses/Chat Completions", "Anthropic Messages"],
  );
  const providerKey = await askOptional(io, "provider key (empty allowed)> ");
  const providerUrl = await askRequired(io, "provider url> ");
  const modelName = await askRequired(io, "model name> ");
  const maxContext = await askPositiveInteger(io, "max context tokens> ");

  mkdirSync(ndxDir, { recursive: true });
  writeFileSync(
    settingsFile,
    `${JSON.stringify(
      {
        model: modelName,
        version: currentSettingsVersion(),
        providers: {
          default: {
            type: providerType,
            key: providerKey,
            url: providerUrl,
          },
        },
        models: [
          {
            name: modelName,
            provider: "default",
            maxContext,
          },
        ],
        permissions: {
          defaultMode: permission,
        },
        keys: {},
      },
      null,
      2,
    )}\n`,
  );
  return settingsFile;
}

export async function repairSettingsWithWizard(
  cwd: string,
  io: SettingsWizardIo,
  globalDir = resolveGlobalNdxDir(),
): Promise<string[]> {
  const files = configFiles(cwd, { globalDir });
  const repaired: string[] = [];
  const globalSettings = files[0];
  if (!existsSync(globalSettings)) {
    repaired.push(await createGlobalSettingsWithWizard(globalDir, io));
  } else {
    repaired.push(await repairSettingsFile(globalSettings, io, true));
  }
  for (const file of files.slice(1)) {
    if (existsSync(file)) {
      repaired.push(await repairSettingsFile(file, io, false));
    }
  }
  return repaired;
}

async function repairSettingsFile(
  settingsFile: string,
  io: SettingsWizardIo,
  requireRuntimeModel: boolean,
): Promise<string> {
  const settings = readSettingsObject(settingsFile);
  settings.version = currentSettingsVersion();
  if (requireRuntimeModel || settings.model !== undefined) {
    await ensureRuntimeModelSettings(settings, io, settingsFile);
  }
  writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  return settingsFile;
}

async function ensureRuntimeModelSettings(
  settings: JsonObject,
  io: SettingsWizardIo,
  settingsFile: string,
): Promise<void> {
  const selectedModel =
    modelSelectionName(settings.model) ??
    (await askRequired(io, `${settingsFile} model name> `));
  settings.model = selectedModel;
  const providers = ensureObject(settings, "providers");
  const provider = modelProvider(settings.models, selectedModel);
  if (provider !== undefined && providers[provider] !== undefined) {
    return;
  }
  const providerName = await askRequired(
    io,
    `${settingsFile} provider name> `,
    "default",
  );
  const providerType = await chooseOption(
    io,
    `${settingsFile} provider type`,
    [...PROVIDER_TYPES],
    ["OpenAI-compatible Responses/Chat Completions", "Anthropic Messages"],
  );
  const providerKey = await askOptional(io, `${settingsFile} provider key> `);
  const providerUrl = await askRequired(io, `${settingsFile} provider url> `);
  providers[providerName] = {
    type: providerType,
    key: providerKey,
    url: providerUrl,
  };
  const maxContext = await askPositiveInteger(
    io,
    `${settingsFile} max context tokens> `,
  );
  addModelSettings(settings, selectedModel, providerName, maxContext);
}

function readSettingsObject(settingsFile: string): JsonObject {
  const parsed = JSON.parse(readFileSync(settingsFile, "utf8")) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error(`${settingsFile} must contain a JSON object`);
  }
  return parsed as JsonObject;
}

function ensureObject(settings: JsonObject, key: string): JsonObject {
  const existing = settings[key];
  if (
    typeof existing === "object" &&
    existing !== null &&
    !Array.isArray(existing)
  ) {
    return existing as JsonObject;
  }
  const created: JsonObject = {};
  settings[key] = created;
  return created;
}

function modelSelectionName(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const session = (value as JsonObject).session;
  if (typeof session === "string" && session.length > 0) {
    return session;
  }
  if (
    Array.isArray(session) &&
    typeof session[0] === "string" &&
    session[0].length > 0
  ) {
    return session[0];
  }
  return undefined;
}

function modelProvider(
  models: unknown,
  selectedModel: string,
): string | undefined {
  if (Array.isArray(models)) {
    const model = models.find(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        !Array.isArray(entry) &&
        (entry as JsonObject).name === selectedModel,
    ) as JsonObject | undefined;
    return typeof model?.provider === "string" ? model.provider : undefined;
  }
  if (
    typeof models === "object" &&
    models !== null &&
    !Array.isArray(models)
  ) {
    const model = (models as JsonObject)[selectedModel];
    if (typeof model === "object" && model !== null && !Array.isArray(model)) {
      const provider = (model as JsonObject).provider;
      return typeof provider === "string" ? provider : undefined;
    }
  }
  return undefined;
}

function addModelSettings(
  settings: JsonObject,
  selectedModel: string,
  provider: string,
  maxContext: number,
): void {
  const existing = settings.models;
  if (Array.isArray(existing)) {
    const models = existing.filter(
      (model): model is JsonObject =>
        typeof model === "object" && model !== null && !Array.isArray(model),
    );
    models.push({
      name: selectedModel,
      provider,
      maxContext,
    });
    settings.models = models;
    return;
  }
  if (
    typeof existing === "object" &&
    existing !== null &&
    !Array.isArray(existing)
  ) {
    (existing as JsonObject)[selectedModel] = {
      provider,
      maxContext,
    };
    return;
  }
  settings.models = [
    {
      name: selectedModel,
      provider,
      maxContext,
    },
  ];
}

async function chooseOption<T extends string>(
  io: SettingsWizardIo,
  name: string,
  values: T[],
  descriptions: string[],
): Promise<T> {
  io.print(`${name}:`);
  for (const [index, value] of values.entries()) {
    io.print(`  ${index + 1}. ${value} - ${descriptions[index]}`);
  }
  while (true) {
    const answer = (await io.question(`${name}> `)).trim();
    const selected = Number.parseInt(answer, 10);
    if (
      Number.isInteger(selected) &&
      selected >= 1 &&
      selected <= values.length
    ) {
      return values[selected - 1];
    }
    io.print(`choose 1-${values.length}`);
  }
}

async function askOptional(
  io: SettingsWizardIo,
  prompt: string,
): Promise<string> {
  return (await io.question(prompt)).trim();
}

async function askRequired(
  io: SettingsWizardIo,
  prompt: string,
  defaultValue?: string,
): Promise<string> {
  while (true) {
    const answer = (await io.question(prompt)).trim();
    if (answer.length > 0) {
      return answer;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    io.print("value is required");
  }
}

async function askPositiveInteger(
  io: SettingsWizardIo,
  prompt: string,
): Promise<number> {
  while (true) {
    const answer = (await io.question(prompt)).trim();
    const value = Number.parseInt(answer, 10);
    if (Number.isInteger(value) && value > 0 && String(value) === answer) {
      return value;
    }
    io.print("enter a positive integer");
  }
}
