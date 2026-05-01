import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

export type SocialProvider = "google" | "github";

export type StoredLogin =
  | { kind: "default"; username: "defaultUser" }
  | {
      kind: "password";
      username: string;
      password: string;
    }
  | {
      kind: "social";
      provider: SocialProvider;
      username: string;
      subject: string;
      email?: string;
      displayName?: string;
      accessToken: string;
      refreshToken?: string;
    };

export interface LoginStore {
  load(): StoredLogin | undefined;
  save(login: StoredLogin): void;
  path(): string;
}

export interface SocialLoginResult {
  provider: SocialProvider;
  subject: string;
  username: string;
  email?: string;
  displayName?: string;
  accessToken: string;
  refreshToken?: string;
}

export interface LoginPrompts {
  question: (prompt: string) => Promise<string>;
  print: (message: string) => void;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri?: string;
  verification_url?: string;
  interval?: number;
  expires_in: number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

/** Return the host CLI app-state directory, separate from agent `.ndx` state. */
export function resolveCliStateDir(): string {
  if (process.env.NDX_CLI_STATE_DIR !== undefined) {
    return resolve(process.env.NDX_CLI_STATE_DIR);
  }
  if (platform() === "win32" && process.env.LOCALAPPDATA !== undefined) {
    return join(process.env.LOCALAPPDATA, "ndx");
  }
  if (process.env.XDG_STATE_HOME !== undefined) {
    return join(process.env.XDG_STATE_HOME, "ndx");
  }
  return join(homedir(), ".local", "state", "ndx");
}

export function createLoginStore(
  file = join(resolveCliStateDir(), "auth.json"),
): LoginStore {
  return {
    load: () => readStoredLogin(file),
    save: (login) => writeStoredLogin(file, login),
    path: () => file,
  };
}

export function defaultLogin(): StoredLogin {
  return { kind: "default", username: "defaultUser" };
}

export async function performSocialDeviceLogin(
  provider: SocialProvider,
  prompts: LoginPrompts,
): Promise<SocialLoginResult> {
  if (provider === "github") {
    return githubDeviceLogin(prompts);
  }
  return googleDeviceLogin(prompts);
}

function readStoredLogin(file: string): StoredLogin | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return normalizeStoredLogin(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function writeStoredLogin(file: string, login: StoredLogin): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(login, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(tmp, file);
}

function normalizeStoredLogin(value: unknown): StoredLogin | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const login = value as Record<string, unknown>;
  if (login.kind === "default") {
    return defaultLogin();
  }
  if (
    login.kind === "password" &&
    typeof login.username === "string" &&
    typeof login.password === "string"
  ) {
    return {
      kind: "password",
      username: login.username,
      password: login.password,
    };
  }
  if (
    login.kind === "social" &&
    isSocialProvider(login.provider) &&
    typeof login.username === "string" &&
    typeof login.subject === "string" &&
    typeof login.accessToken === "string"
  ) {
    return {
      kind: "social",
      provider: login.provider,
      username: login.username,
      subject: login.subject,
      email: optionalString(login.email),
      displayName: optionalString(login.displayName),
      accessToken: login.accessToken,
      refreshToken: optionalString(login.refreshToken),
    };
  }
  return undefined;
}

function isSocialProvider(value: unknown): value is SocialProvider {
  return value === "google" || value === "github";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function githubDeviceLogin(
  prompts: LoginPrompts,
): Promise<SocialLoginResult> {
  const clientId = process.env.NDX_GITHUB_CLIENT_ID;
  if (clientId === undefined || clientId.length === 0) {
    throw new Error("NDX_GITHUB_CLIENT_ID is required for GitHub login");
  }
  const device = await requestDeviceCode(
    "https://github.com/login/device/code",
    { client_id: clientId, scope: "read:user user:email" },
  );
  const verificationUrl = device.verification_uri ?? device.verification_url;
  if (verificationUrl === undefined) {
    throw new Error("GitHub did not return a verification URL");
  }
  openExternalUrl(verificationUrl);
  prompts.print(`Open ${verificationUrl} and enter code ${device.user_code}`);
  await prompts.question("Press Enter after browser login completes.");
  const token = await pollToken(
    "https://github.com/login/oauth/access_token",
    {
      client_id: clientId,
      device_code: device.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    },
    device,
  );
  const user = await fetchJson(
    "https://api.github.com/user",
    token.access_token,
  );
  const subject = String(requiredJsonField(user, "id"));
  const login = String(requiredJsonField(user, "login"));
  return {
    provider: "github",
    subject,
    username: `github:${subject}`,
    displayName: login,
    email: optionalString((user as Record<string, unknown>).email),
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
  };
}

async function googleDeviceLogin(
  prompts: LoginPrompts,
): Promise<SocialLoginResult> {
  const clientId = process.env.NDX_GOOGLE_CLIENT_ID;
  if (clientId === undefined || clientId.length === 0) {
    throw new Error("NDX_GOOGLE_CLIENT_ID is required for Google login");
  }
  const device = await requestDeviceCode(
    "https://oauth2.googleapis.com/device/code",
    {
      client_id: clientId,
      scope: "openid email profile",
    },
  );
  const verificationUrl = device.verification_uri ?? device.verification_url;
  if (verificationUrl === undefined) {
    throw new Error("Google did not return a verification URL");
  }
  openExternalUrl(verificationUrl);
  prompts.print(`Open ${verificationUrl} and enter code ${device.user_code}`);
  await prompts.question("Press Enter after browser login completes.");
  const token = await pollToken(
    "https://oauth2.googleapis.com/token",
    {
      client_id: clientId,
      device_code: device.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    },
    device,
  );
  const user = await fetchJson(
    "https://openidconnect.googleapis.com/v1/userinfo",
    token.access_token,
  );
  const subject = String(requiredJsonField(user, "sub"));
  return {
    provider: "google",
    subject,
    username: `google:${subject}`,
    email: optionalString((user as Record<string, unknown>).email),
    displayName: optionalString((user as Record<string, unknown>).name),
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
  };
}

async function requestDeviceCode(
  url: string,
  body: Record<string, string>,
): Promise<DeviceCodeResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
  if (!response.ok) {
    throw new Error(`device login failed: ${response.status}`);
  }
  const json = (await response.json()) as DeviceCodeResponse;
  if (
    typeof json.device_code !== "string" ||
    typeof json.user_code !== "string" ||
    typeof json.expires_in !== "number"
  ) {
    throw new Error("device login response is incomplete");
  }
  return json;
}

async function pollToken(
  url: string,
  body: Record<string, string>,
  device: DeviceCodeResponse,
): Promise<{ access_token: string; refresh_token?: string }> {
  const started = Date.now();
  const intervalMs = Math.max(device.interval ?? 5, 1) * 1000;
  while (Date.now() - started < device.expires_in * 1000) {
    await delay(intervalMs);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
    });
    const json = (await response.json()) as TokenResponse;
    if (typeof json.access_token === "string") {
      return {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
      };
    }
    if (json.error === "authorization_pending" || json.error === "slow_down") {
      continue;
    }
    throw new Error(json.error_description ?? json.error ?? "login failed");
  }
  throw new Error("login timed out");
}

async function fetchJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "authorization": `Bearer ${token}`,
      "user-agent": "ndx-cli",
    },
  });
  if (!response.ok) {
    throw new Error(`profile request failed: ${response.status}`);
  }
  return response.json();
}

function requiredJsonField(value: unknown, field: string): unknown {
  if (value === null || typeof value !== "object" || !(field in value)) {
    throw new Error(`profile response missing ${field}`);
  }
  return (value as Record<string, unknown>)[field];
}

function openExternalUrl(url: string): void {
  const command =
    platform() === "win32"
      ? "cmd"
      : platform() === "darwin"
        ? "open"
        : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
