import { NDX_DEFAULTS } from "../../config/defaults.js";
import { defaultDockerSandboxImage } from "../docker-sandbox.js";
import type { SessionServerAddress } from "../server.js";
import type { NdxConfig, JsonObject } from "../../shared/types.js";

export interface ServerInfoInput {
  address: SessionServerAddress | undefined;
  config: NdxConfig;
  dockerSandboxImage?: string;
  packageVersion: string;
  requireDockerSandbox?: boolean;
}

/** Build the public server identity payload returned before socket login. */
export function buildServerInfo(input: ServerInfoInput): JsonObject {
  const sandboxImage =
    input.dockerSandboxImage ??
    input.config.tools.dockerSandboxImage ??
    defaultDockerSandboxImage();
  return {
    server: NDX_DEFAULTS.serverName,
    version: input.packageVersion,
    protocolVersion: NDX_DEFAULTS.protocolVersion,
    dashboardUrl: input.address?.dashboardUrl,
    runtime: {
      kind: "host-process",
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    toolSandbox: {
      kind: input.requireDockerSandbox === true ? "docker" : "disabled",
      image: sandboxImage,
      workspaceMount: NDX_DEFAULTS.containerWorkspaceDir,
      globalMount: NDX_DEFAULTS.containerGlobalDir,
    },
  };
}
