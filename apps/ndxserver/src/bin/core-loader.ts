type CliModule = typeof import("@neurondev/ndx-core/cli");

/** Load core from installed package resolution, falling back to repo-local dist. */
export async function loadCoreCli(): Promise<CliModule> {
  try {
    return await import("@neurondev/ndx-core/cli");
  } catch (error) {
    if (!isMissingCorePackage(error)) {
      throw error;
    }
    return await import("../../../../packages/ndx/dist/cli/main.js");
  }
}

function isMissingCorePackage(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: unknown }).code === "ERR_MODULE_NOT_FOUND" &&
    error.message.includes("@neurondev/ndx-core")
  );
}

