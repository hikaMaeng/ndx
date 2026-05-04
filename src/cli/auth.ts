import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

export type StoredLogin = { kind: "local"; username: string };

export interface LoginStore {
  load(): StoredLogin | undefined;
  save(login: StoredLogin): void;
  path(): string;
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
    load: () => undefined,
    save: (_login) => undefined,
    path: () => file,
  };
}

export function defaultLogin(): StoredLogin {
  return { kind: "local", username: "defaultuser" };
}
