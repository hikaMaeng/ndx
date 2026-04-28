import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { stdin, stdout } from "node:process";

const request = JSON.parse(await readStdin());
const args = request.arguments ?? {};
const command = String(args.command ?? "");
const cwd = resolve(String(args.cwd ?? request.cwd ?? process.env.NDX_TOOL_CWD ?? process.cwd()));
const timeoutMs = Number.isInteger(args.timeoutMs) ? args.timeoutMs : 120000;
const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
const shellArgs =
  process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];

const result = await new Promise((resolveResult, reject) => {
  const child = spawn(shell, shellArgs, {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let out = "";
  let err = "";
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    out += chunk;
  });
  child.stderr.on("data", (chunk) => {
    err += chunk;
  });
  child.on("error", reject);
  child.on("close", (exitCode) => {
    clearTimeout(timer);
    resolveResult({ command, cwd, exitCode, stdout: out, stderr: err, timedOut });
  });
});

stdout.write(`${JSON.stringify(result)}\n`);

function readStdin() {
  return new Promise((resolveRead) => {
    let body = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => {
      body += chunk;
    });
    stdin.on("end", () => {
      resolveRead(body);
    });
  });
}
