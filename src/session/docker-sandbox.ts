import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { mapHostPathToSandboxPath } from "./sandbox-paths.js";

export interface DockerSandboxOptions {
  workspaceDir: string;
  globalDir?: string;
  image?: string;
  containerName?: string;
}

export interface DockerSandboxState {
  workspaceDir: string;
  globalDir: string;
  image: string;
  containerName: string;
  containerWorkspaceDir: string;
  containerGlobalDir: string;
}

const DEFAULT_SANDBOX_IMAGE = "hika00/ndx-sandbox:0.1.0";
const CONTAINER_WORKSPACE_DIR = "/workspace";
const CONTAINER_GLOBAL_DIR = "/home/.ndx";
const SANDBOX_ROLE_LABEL = "dev.ndx.role";
const SANDBOX_WORKSPACE_LABEL = "dev.ndx.workspace";
const SANDBOX_OWNER_LABEL = "dev.ndx.owner";
const SANDBOX_IMAGE_LABEL = "dev.ndx.image";
const SANDBOX_ROLE = "tool-sandbox";
const SANDBOX_OWNER = "ndx-server";
const DOCKER_SANDBOX_RUN_TEMPLATE = [
  "run",
  "-d",
  "--name",
  "${containerName}",
  "${labels}",
  "-v",
  "${globalMount}",
  "-v",
  "${workspaceMount}",
  "-v",
  "/var/run/docker.sock:/var/run/docker.sock",
  "-e",
  "${globalEnv}",
  "-w",
  "${workdir}",
  "${image}",
  "sleep",
  "infinity",
].join("\n");

/** Resolve the Docker sandbox image pinned by this server build. */
export function defaultDockerSandboxImage(): string {
  return process.env.NDX_SANDBOX_IMAGE ?? DEFAULT_SANDBOX_IMAGE;
}

/** Return the stable per-workspace sandbox container identity. */
export function dockerSandboxState(
  options: DockerSandboxOptions,
): DockerSandboxState {
  const workspaceDir = resolve(options.workspaceDir);
  const globalDir = resolve(options.globalDir ?? resolve(homedir(), ".ndx"));
  return {
    workspaceDir,
    globalDir,
    image: options.image ?? defaultDockerSandboxImage(),
    containerName:
      options.containerName ?? `ndx-tool-${dockerNamePart(workspaceDir)}`,
    containerWorkspaceDir: CONTAINER_WORKSPACE_DIR,
    containerGlobalDir: CONTAINER_GLOBAL_DIR,
  };
}

/** Return Docker labels that identify containers opened by the ndx server. */
export function dockerSandboxLabels(state: DockerSandboxState): string[] {
  return [
    `${SANDBOX_ROLE_LABEL}=${SANDBOX_ROLE}`,
    `${SANDBOX_OWNER_LABEL}=${SANDBOX_OWNER}`,
    `${SANDBOX_WORKSPACE_LABEL}=${state.workspaceDir}`,
    `${SANDBOX_IMAGE_LABEL}=${state.image}`,
  ];
}

/** Remove all server-owned tool sandbox containers from prior server runs. */
export async function reclaimDockerSandboxes(): Promise<string[]> {
  const ids = new Set<string>();
  for (const label of [
    `${SANDBOX_OWNER_LABEL}=${SANDBOX_OWNER}`,
    `${SANDBOX_ROLE_LABEL}=${SANDBOX_ROLE}`,
  ]) {
    const found = await run("docker", [
      "ps",
      "-aq",
      "--filter",
      `label=${label}`,
    ]);
    if (found.exitCode !== 0) {
      continue;
    }
    for (const id of found.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)) {
      ids.add(id);
    }
  }
  if (ids.size === 0) {
    return [];
  }
  const names = [...ids];
  await runDocker(["rm", "-f", ...names]);
  return names;
}

/** Ensure Docker can provide the workspace-bound tool sandbox. */
export async function ensureDockerSandbox(
  options: DockerSandboxOptions,
): Promise<DockerSandboxState> {
  const state = dockerSandboxState(options);
  mkdirSync(state.globalDir, { recursive: true });
  const image = await run("docker", ["image", "inspect", state.image]);
  if (image.exitCode !== 0) {
    await runDocker(["pull", state.image]);
  }
  const labeled = await findLabeledSandbox(state);
  if (labeled !== undefined) {
    if (labeled.running) {
      return { ...state, containerName: labeled.name };
    }
    await runDocker(["rm", "-f", labeled.name]);
  }
  const container = await availableContainerName(state);
  if (container.running) {
    return { ...state, containerName: container.name };
  }
  await runDocker(dockerSandboxRunArgs(state, container.name));
  return { ...state, containerName: container.name };
}

export function dockerSandboxRunArgs(
  state: DockerSandboxState,
  containerName = state.containerName,
): string[] {
  return renderDockerArgs(DOCKER_SANDBOX_RUN_TEMPLATE, {
    containerName,
    labels: dockerSandboxLabels(state).flatMap((label) => ["--label", label]),
    globalMount: `${state.globalDir}:${state.containerGlobalDir}`,
    workspaceMount: `${state.workspaceDir}:${state.containerWorkspaceDir}`,
    globalEnv: `NDX_GLOBAL_DIR=${state.containerGlobalDir}`,
    workdir: state.containerWorkspaceDir,
    image: state.image,
  });
}

function dockerNamePart(path: string): string {
  const raw = basename(path) || "workspace";
  const safe = raw.replace(/[^a-zA-Z0-9_.-]/g, "-");
  return /^[a-zA-Z0-9]/.test(safe) ? safe : `workspace-${safe}`;
}

function dockerNameHash(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 12);
}

function renderDockerArgs(
  template: string,
  values: Record<string, string | string[]>,
): string[] {
  const args: string[] = [];
  for (const rawLine of template.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const placeholder = /^\$\{([A-Za-z][A-Za-z0-9_]*)\}$/.exec(line);
    if (placeholder === null) {
      args.push(line);
      continue;
    }
    const value = values[placeholder[1]];
    if (value === undefined) {
      throw new Error(
        `missing docker sandbox template value: ${placeholder[1]}`,
      );
    }
    if (Array.isArray(value)) {
      args.push(...value);
    } else {
      args.push(value);
    }
  }
  return args;
}

async function availableContainerName(
  state: DockerSandboxState,
): Promise<{ name: string; running: boolean }> {
  const preferred = state.containerName;
  const preferredInspect = await inspectSandboxContainer(preferred);
  if (preferredInspect === undefined) {
    return { name: preferred, running: false };
  }
  if (preferredInspect.workspaceDir === state.workspaceDir) {
    if (preferredInspect.running) {
      return { name: preferredInspect.name, running: true };
    }
    await runDocker(["rm", "-f", preferredInspect.name]);
    return { name: preferred, running: false };
  }
  const fallback = `${preferred}-${dockerNameHash(state.workspaceDir)}`;
  const fallbackInspect = await inspectSandboxContainer(fallback);
  if (fallbackInspect === undefined) {
    return { name: fallback, running: false };
  }
  if (fallbackInspect.workspaceDir === state.workspaceDir) {
    if (fallbackInspect.running) {
      return { name: fallbackInspect.name, running: true };
    }
    await runDocker(["rm", "-f", fallbackInspect.name]);
    return { name: fallback, running: false };
  }
  throw new Error(
    `docker sandbox container name collision for ${state.workspaceDir}: ${fallback}`,
  );
}

async function findLabeledSandbox(
  state: DockerSandboxState,
): Promise<
  | { name: string; running: boolean; workspaceDir: string | undefined }
  | undefined
> {
  const found = await run("docker", [
    "ps",
    "-aq",
    "--filter",
    `label=${SANDBOX_ROLE_LABEL}=${SANDBOX_ROLE}`,
    "--filter",
    `label=${SANDBOX_WORKSPACE_LABEL}=${state.workspaceDir}`,
  ]);
  if (found.exitCode !== 0) {
    return undefined;
  }
  const [id] = found.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return id === undefined ? undefined : inspectSandboxContainer(id);
}

async function inspectSandboxContainer(
  name: string,
): Promise<
  | { name: string; running: boolean; workspaceDir: string | undefined }
  | undefined
> {
  const inspect = await run("docker", [
    "inspect",
    "-f",
    `{{.Name}}|{{.State.Running}}|{{if .Config.Labels}}{{index .Config.Labels "${SANDBOX_WORKSPACE_LABEL}"}}{{end}}`,
    name,
  ]);
  if (inspect.exitCode !== 0) {
    return undefined;
  }
  const [rawName = name, running = "false", workspaceDir] = inspect.stdout
    .trim()
    .split("|");
  return {
    name: rawName.startsWith("/") ? rawName.slice(1) : rawName,
    running: running === "true",
    workspaceDir: workspaceDir === "" ? undefined : workspaceDir,
  };
}

export function hostPathToSandboxPath(
  state: DockerSandboxState,
  path: string,
): string {
  return mapHostPathToSandboxPath(path, {
    hostWorkspace: state.workspaceDir,
    sandboxWorkspace: state.containerWorkspaceDir,
    sandboxCwd: state.containerWorkspaceDir,
    hostGlobal: state.globalDir,
    sandboxGlobal: state.containerGlobalDir,
  });
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
