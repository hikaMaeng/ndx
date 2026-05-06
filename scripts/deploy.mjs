#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const composeProject =
  process.env.NDX_DEPLOY_COMPOSE_PROJECT ?? `ndx-deploy-${process.pid}`;
const legacyComposeContainerNames = ["ndx-ndx-sandbox-1"];
const legacyComposeNetworkNames = ["ndx_default"];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.silent ? "ignore" : "inherit",
    shell: process.platform === "win32",
  });
  if (!options.allowFailure && result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return result;
}

function cleanupComposeResources() {
  run("docker", ["compose", "-p", composeProject, "down", "--remove-orphans"], {
    allowFailure: true,
  });
}

function cleanupLegacyDefaultComposeResources() {
  run("docker", ["compose", "down", "--remove-orphans"], {
    allowFailure: true,
  });

  for (const name of legacyComposeContainerNames) {
    run("docker", ["rm", "-f", name], {
      allowFailure: true,
      silent: true,
    });
  }

  for (const name of legacyComposeNetworkNames) {
    run("docker", ["network", "rm", name], {
      allowFailure: true,
      silent: true,
    });
  }
}

run("yarn", ["build"]);
run("yarn", ["test"]);

cleanupLegacyDefaultComposeResources();
try {
  cleanupComposeResources();
  run("docker", [
    "compose",
    "-p",
    composeProject,
    "build",
    "--no-cache",
    "ndx-sandbox",
  ]);
  run("docker", ["compose", "-p", composeProject, "up", "-d", "ndx-sandbox"]);
  run("docker", [
    "compose",
    "-p",
    composeProject,
    "exec",
    "-T",
    "ndx-sandbox",
    "bash",
    "-lc",
    "mkdir -p /workspace/tmp && echo verified > /workspace/tmp/ndx-docker-verify.txt",
  ]);
} finally {
  cleanupComposeResources();
}
