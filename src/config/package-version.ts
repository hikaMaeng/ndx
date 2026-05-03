import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Read the installed package version from the nearest package.json. */
export function readPackageVersion(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = join(current, "package.json");
    if (existsSync(candidate)) {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as {
        version?: unknown;
      };
      return typeof parsed.version === "string" ? parsed.version : "unknown";
    }
    const parent = dirname(current);
    if (parent === current) {
      return "unknown";
    }
    current = parent;
  }
}

/** Return the package version that settings.json must declare. */
export function currentSettingsVersion(): string {
  const version = readPackageVersion();
  if (version === "unknown" || version.length === 0) {
    throw new Error("package.json was not found for settings version");
  }
  return version;
}
