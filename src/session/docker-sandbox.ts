import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export interface DockerSandboxOptions {
  workspaceDir: string;
  image?: string;
  containerName?: string;
}

export interface DockerSandboxState {
  workspaceDir: string;
  image: string;
  containerName: string;
  containerWorkspaceDir: string;
}

const DEFAULT_SANDBOX_IMAGE = "hika00/ndx-sandbox:0.1.0";
const CONTAINER_WORKSPACE_DIR = "/workspace";

/** Resolve the Docker sandbox image pinned by this server build. */
export function defaultDockerSandboxImage(): string {
  return process.env.NDX_SANDBOX_IMAGE ?? DEFAULT_SANDBOX_IMAGE;
}

/** Return the stable per-workspace sandbox container identity. */
export function dockerSandboxState(
  options: DockerSandboxOptions,
): DockerSandboxState {
  const workspaceDir = resolve(options.workspaceDir);
  const key = createHash("sha256")
    .update(workspaceDir)
    .digest("hex")
    .slice(0, 16);
  return {
    workspaceDir,
    image: options.image ?? defaultDockerSandboxImage(),
    containerName: options.containerName ?? `ndx-sandbox-${key}`,
    containerWorkspaceDir: CONTAINER_WORKSPACE_DIR,
  };
}

/** Ensure Docker can provide the workspace-bound tool sandbox. */
export async function ensureDockerSandbox(
  options: DockerSandboxOptions,
): Promise<DockerSandboxState> {
  const state = dockerSandboxState(options);
  const image = await run("docker", ["image", "inspect", state.image]);
  if (image.exitCode !== 0) {
    await runDocker(["pull", state.image]);
  }
  const inspect = await run("docker", [
    "inspect",
    "-f",
    "{{.State.Running}}",
    state.containerName,
  ]);
  if (inspect.exitCode === 0 && inspect.stdout.trim() === "true") {
    return state;
  }
  if (inspect.exitCode === 0) {
    await runDocker(["rm", "-f", state.containerName]);
  }
  await runDocker([
    "run",
    "-d",
    "--name",
    state.containerName,
    "-v",
    `${state.workspaceDir}:${state.containerWorkspaceDir}`,
    "-w",
    state.containerWorkspaceDir,
    state.image,
    "sleep",
    "infinity",
  ]);
  return state;
}

export function hostPathToSandboxPath(
  state: DockerSandboxState,
  path: string,
): string {
  const resolved = resolve(path);
  if (resolved === state.workspaceDir) {
    return state.containerWorkspaceDir;
  }
  if (resolved.startsWith(`${state.workspaceDir}/`)) {
    return `${state.containerWorkspaceDir}${resolved.slice(state.workspaceDir.length)}`;
  }
  return state.containerWorkspaceDir;
}

async function runDocker(
  args: string[],
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const result = await run("docker", args);
  if (result.exitCode !== 0) {
    throw new Error(
      [
        `docker ${args.join(" ")} exited with ${result.exitCode}`,
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result;
}

function run(
  command: string,
  args: string[],
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolveRun({ exitCode, stdout, stderr });
    });
  });
}
