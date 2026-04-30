import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

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

export async function createProjectSettingsWithWizard(
  cwd: string,
  io: SettingsWizardIo,
): Promise<string> {
  const projectNdxDir = join(resolve(cwd), ".ndx");
  const settingsFile = join(projectNdxDir, "settings.json");

  io.print("ndx settings were not found.");
  io.print(`creating project settings at ${settingsFile}`);

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

  mkdirSync(projectNdxDir, { recursive: true });
  writeFileSync(
    settingsFile,
    `${JSON.stringify(
      {
        model: modelName,
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
): Promise<string> {
  while (true) {
    const answer = (await io.question(prompt)).trim();
    if (answer.length > 0) {
      return answer;
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
