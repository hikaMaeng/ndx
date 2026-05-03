import { randomUUID } from "node:crypto";
import {
  defaultLogin,
  performSocialDeviceLogin,
  type LoginStore,
  type StoredLogin,
} from "./auth.js";
import type { SessionNotification } from "../session/client.js";
import type {
  RuntimeEventMsg,
  SessionConfiguredEvent,
} from "../shared/protocol.js";
import type { NdxBootstrapReport } from "../shared/types.js";

export interface CliSessionRuntime {
  client: CliSessionTransport;
  cwd: string;
  print?: (message: string) => void;
  printError?: (message: string) => void;
  question?: (prompt: string) => Promise<string>;
  user?: string;
  clientId?: string;
  loginStore?: LoginStore;
}

export interface CliSessionTransport {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  onNotification(
    handler: (notification: SessionNotification) => void,
  ): () => void;
}

export interface InitializeResult {
  server?: string;
  version?: string;
  protocolVersion?: number;
  dashboardUrl?: string;
  runtime?: ServerRuntimeInfo;
  toolSandbox?: ToolSandboxInfo;
  methods?: string[];
  bootstrap?: NdxBootstrapReport;
}

export interface ServerInfoResult {
  server?: string;
  version?: string;
  protocolVersion?: number;
  dashboardUrl?: string;
  runtime?: ServerRuntimeInfo;
  toolSandbox?: ToolSandboxInfo;
}

interface ServerRuntimeInfo {
  kind?: string;
  node?: string;
  platform?: string;
  arch?: string;
}

interface ToolSandboxInfo {
  kind?: string;
  image?: string;
  workspaceMount?: string;
  globalMount?: string;
}

export interface SessionSummary {
  id: string;
  sessionId?: string;
  cwd: string;
  status: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  number?: number;
  title?: string;
}

export interface SessionListEntry {
  number: number;
  id: string;
  cwd: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  eventCount: number;
  live: boolean;
  title: string;
}

type CommandResult =
  | { handled: true; shouldExit: true }
  | { handled: true; shouldExit: false }
  | { handled: false };

type ServerCommandResult =
  | { handled: true; action: "print"; output: string }
  | {
      handled: true;
      action: "restore";
      output: string;
      session: SessionSummary;
      thread?: SessionSummary;
    }
  | { handled: true; action: "deleteSession"; output: string }
  | { handled: true; action: "exit"; output?: string }
  | { handled: false; output: string };

/** CLI-side session-server client facade. */
export class CliSessionController {
  private readonly client: CliSessionTransport;
  private cwd: string;
  private readonly print: (message: string) => void;
  private readonly printError: (message: string) => void;
  private readonly question: ((prompt: string) => Promise<string>) | undefined;
  private readonly clientId: string;
  private readonly loginStore: LoginStore | undefined;
  private login: StoredLogin;
  private initializeResult: InitializeResult | undefined;
  private session: SessionSummary | undefined;
  private sessionConfigured: SessionConfiguredEvent | undefined;
  private deletedSessionMessage: string | undefined;
  private printedBootstrapGlobalDir: string | undefined;
  private printedServerInfo = false;

  constructor(options: CliSessionRuntime) {
    this.client = options.client;
    this.cwd = options.cwd;
    this.print = options.print ?? console.log;
    this.printError = options.printError ?? console.error;
    this.question = options.question;
    this.clientId = options.clientId ?? randomUUID();
    this.loginStore = options.loginStore;
    this.login =
      options.loginStore?.load() ??
      (options.user === undefined
        ? defaultLogin()
        : options.user === "defaultUser"
          ? defaultLogin()
          : { kind: "password", username: options.user, password: "" });
    this.client.onNotification((notification) => {
      if (notification.method !== "session/deleted") {
        return;
      }
      const params = notification.params as
        | { sessionId?: unknown; message?: unknown }
        | undefined;
      const sessionId =
        typeof params?.sessionId === "string" ? params.sessionId : undefined;
      if (this.session !== undefined && sessionId !== this.session.id) {
        return;
      }
      const message =
        typeof params?.message === "string"
          ? params.message
          : "session was deleted";
      this.deletedSessionMessage = message;
      this.printError(`[session] ${message}`);
    });
  }

  async initialize(): Promise<void> {
    await this.printPublicServerInfo();
    await this.selectStartupLogin();
    await this.loginWithStoredIdentity(this.login);
    this.initializeResult =
      await this.client.request<InitializeResult>("initialize");
    this.printError(
      formatInitializeResult(this.initializeResult, !this.printedServerInfo),
    );
    this.printLoginStatus(this.login);
    this.printedBootstrapGlobalDir = this.initializeResult.bootstrap?.globalDir;
  }

  async startSession(): Promise<string> {
    const response = await this.client.request<{ session: SessionSummary }>(
      "session/start",
      this.requestParams({ cwd: this.cwd }),
    );
    this.session = response.session;
    this.printError(formatSessionStarted(response.session));
    return response.session.id;
  }

  async listSessions(): Promise<SessionListEntry[]> {
    const response = await this.client.request<{
      sessions: SessionListEntry[];
    }>("session/list", this.requestParams({ cwd: this.cwd }));
    return response.sessions;
  }

  formatSessionChoices(sessions: SessionListEntry[]): string {
    return formatSessionChoices(this.cwd, sessions);
  }

  async restoreSession(selector: string): Promise<string> {
    const response = await this.client.request<{
      session: SessionSummary;
      events: unknown[];
    }>("session/restore", this.requestParams({ cwd: this.cwd, selector }));
    this.session = response.session;
    this.print(
      `restored session ${response.session.number}: ${response.session.title ?? "empty"}`,
    );
    return response.session.id;
  }

  async runPrompt(prompt: string): Promise<void> {
    const sessionId = this.requireSessionId();
    const completion = new Promise<string>((resolve, reject) => {
      const off = this.client.onNotification((notification) => {
        if (notification.method === "session/deleted") {
          off();
          reject(
            new Error(this.deletedSessionMessage ?? "session was deleted"),
          );
          return;
        }
        const msg = runtimeEvent(notification);
        if (msg === undefined) {
          return;
        }
        if (msg.type === "session_configured") {
          this.sessionConfigured = msg;
          this.printError(
            formatSessionConfigured(msg, this.printedBootstrapGlobalDir),
          );
          return;
        }
        if (msg.type === "tool_call") {
          this.printError(`[tool:${msg.name}] ${msg.arguments}`);
          return;
        }
        if (msg.type === "tool_result") {
          this.printError(`[tool:result] ${msg.output}`);
          return;
        }
        if (msg.type === "warning") {
          this.printError(`[warning] ${msg.message}`);
          return;
        }
        if (msg.type === "turn_complete") {
          off();
          resolve(msg.finalText);
          return;
        }
        if (msg.type === "turn_aborted") {
          off();
          reject(new Error(msg.reason));
          return;
        }
        if (msg.type === "error") {
          off();
          reject(new Error(msg.message));
        }
      });
    });
    await this.client.request(
      "turn/start",
      this.requestParams({ sessionId, prompt }),
    );
    const text = await completion;
    if (text) {
      this.print(text);
    }
  }

  async handleCommand(input: string): Promise<CommandResult> {
    const parsed = parseSlashCommand(input);
    if (parsed === undefined) {
      return { handled: false };
    }
    if (parsed.name === "login") {
      await this.handleLoginCommand();
      return { handled: true, shouldExit: false };
    }
    if (parsed.name === "deleteSession") {
      await this.handleDeleteSession(parsed.args);
      return {
        handled: true,
        shouldExit: this.deletedSessionMessage !== undefined,
      };
    }
    const result = await this.client.request<ServerCommandResult>(
      "command/execute",
      this.requestParams({
        name: parsed.name,
        args: parsed.args,
        sessionId: this.session?.id,
        cwd: this.cwd,
      }),
    );
    if (!result.handled) {
      this.print(result.output);
      return { handled: true, shouldExit: false };
    }
    if (result.output !== undefined && result.output.length > 0) {
      this.print(result.output);
    }
    if (result.action === "restore") {
      this.session = result.session;
    }
    return {
      handled: true,
      shouldExit: result.action === "exit",
    };
  }

  shouldExit(): boolean {
    return this.deletedSessionMessage !== undefined;
  }

  private async loginWithStoredIdentity(login: StoredLogin): Promise<void> {
    if (login.kind === "social") {
      await this.client.request("account/socialLogin", {
        provider: login.provider,
        subject: login.subject,
        email: login.email,
        displayName: login.displayName,
        accessToken: login.accessToken,
        refreshToken: login.refreshToken,
        clientId: this.clientId,
      });
      return;
    }
    await this.client.request("account/login", {
      username: login.username,
      password: login.kind === "password" ? login.password : "",
      clientId: this.clientId,
    });
  }

  private async printPublicServerInfo(): Promise<void> {
    try {
      const result = await this.client.request<ServerInfoResult | null>(
        "server/info",
      );
      if (isServerInfoResult(result)) {
        this.printError(formatServerInfo(result));
        this.printedServerInfo = true;
        return;
      }
    } catch {
      // Older servers do not expose pre-login info; initialize will still run.
    }
    this.printError("[socket] connected");
    this.printedServerInfo = true;
  }

  private async selectStartupLogin(): Promise<void> {
    if (this.question === undefined) {
      return;
    }
    const choices = startupLoginChoices(this.login);
    this.print(["login", ...choices.map(formatStartupLoginChoice)].join("\n"));
    const answer = (await this.question("login> ")).trim();
    const selected =
      choices.find((choice) => choice.key === answer) ?? choices[0];
    if (selected.action === "previous" || selected.action === "default") {
      this.login = selected.login;
      if (selected.action === "default") {
        this.loginStore?.save(this.login);
      }
      return;
    }
    const social = await performSocialDeviceLogin("google", {
      question: this.question,
      print: this.print,
    });
    this.login = {
      kind: "social",
      provider: social.provider,
      username: social.username,
      subject: social.subject,
      email: social.email,
      displayName: social.displayName,
      accessToken: social.accessToken,
      refreshToken: social.refreshToken,
    };
    this.loginStore?.save(this.login);
  }

  private printLoginStatus(login: StoredLogin): void {
    this.printError(`[login] ${describeLogin(login)}`);
  }

  private async handleLoginCommand(): Promise<void> {
    if (this.question === undefined) {
      this.print("login requires an interactive CLI");
      return;
    }
    this.print(
      [
        "login",
        "1. Google login",
        "2. GitHub login",
        "3. Keep current account",
        "4. Switch to default user",
      ].join("\n"),
    );
    const answer = (await this.question("login> ")).trim();
    if (answer === "1" || answer === "2") {
      const provider = answer === "1" ? "google" : "github";
      const social = await performSocialDeviceLogin(provider, {
        question: this.question,
        print: this.print,
      });
      const login: StoredLogin = {
        kind: "social",
        provider: social.provider,
        username: social.username,
        subject: social.subject,
        email: social.email,
        displayName: social.displayName,
        accessToken: social.accessToken,
        refreshToken: social.refreshToken,
      };
      await this.loginWithStoredIdentity(login);
      this.login = login;
      this.loginStore?.save(login);
      this.print(`logged in as ${login.username}`);
      return;
    }
    if (answer === "4") {
      const login = defaultLogin();
      await this.loginWithStoredIdentity(login);
      this.login = login;
      this.loginStore?.save(login);
      this.print("logged in as defaultUser");
      return;
    }
    this.print("kept current account");
  }

  private async handleDeleteSession(
    selector: string | undefined,
  ): Promise<void> {
    if (selector !== undefined) {
      const response = await this.client.request<{
        message: string;
      }>(
        "session/delete",
        this.requestParams({
          cwd: this.cwd,
          selector,
          currentSessionId: this.session?.id,
        }),
      );
      this.print(response.message);
      return;
    }
    const response = await this.client.request<{
      sessions: SessionListEntry[];
    }>(
      "session/deleteCandidates",
      this.requestParams({
        cwd: this.cwd,
        currentSessionId: this.session?.id,
      }),
    );
    if (response.sessions.length === 0) {
      this.print(`delete sessions for ${this.cwd}\nno deletable sessions`);
      return;
    }
    this.print(formatDeleteSessionChoices(this.cwd, response.sessions));
    if (this.question === undefined) {
      this.print("run /deleteSession <number> to delete a listed session");
      return;
    }
    const answer = (await this.question("deleteSession> ")).trim();
    if (answer.length === 0) {
      this.print("delete cancelled");
      return;
    }
    if (
      !response.sessions.some((session) => String(session.number) === answer)
    ) {
      this.print("choose a listed session number or press Enter to cancel");
      return;
    }
    const deleted = await this.client.request<{ message: string }>(
      "session/delete",
      this.requestParams({
        cwd: this.cwd,
        selector: answer,
        currentSessionId: this.session?.id,
      }),
    );
    this.print(deleted.message);
  }

  private requireSessionId(): string {
    if (this.session === undefined) {
      throw new Error("session has not been started");
    }
    return this.session.id;
  }

  private requestParams<T extends Record<string, unknown>>(
    params: T,
  ): T & { clientId: string } {
    return { ...params, clientId: this.clientId };
  }
}

export function printWelcomeLogo(
  printError: (message: string) => void = console.error,
): void {
  printError(WELCOME_LOGO);
}

export const WELCOME_LOGO = String.raw`⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣺⣟⣿⢶⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣴⣖⣶⣤⡀⠀⠀⠀⠀⠀⣾⣳⡟⠁⠉⢻⣟⣧⠀⠀⠀⠀⠀⢀⣤⣶⢶⣤⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⣼⢿⡽⠚⠓⢿⣽⡆⠀⠀⠀⠀⣿⣻⣆⠀⢀⣸⣯⡷⠀⠀⠀⠀⣰⣿⠯⠛⠫⢿⣽⣦⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⢿⡀⠀⠀⣸⣯⡿⠀⠀⠀⠀⠈⠻⣾⢿⣻⣯⠗⠁⠀⠀⠀⠀⣿⣽⡅⠀⠀⢠⣿⣾⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠹⣟⣿⣳⣾⣳⣯⣧⠀⠀⠀⠀⠀⠀⠨⣿⣻⠀⠀⠀⠀⠀⠀⢀⡼⣷⣟⣷⣞⣯⡷⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠋⠚⠉⠳⣻⣟⣦⡀⠀⠀⠀⠨⣟⣿⠀⠀⠀⠀⢀⣴⣿⣻⠝⠈⠓⠙⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠹⢯⣿⣄⠀⠀⠨⣿⣻⠀⠀⠀⣴⢿⣻⠊⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⡿⣾⠀⠀⠨⣟⣿⠀⠀⠀⣿⣟⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣻⠀⠀⠨⣿⣻⠀⠀⠈⣯⣿⠅⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⣴⢶⡶⣿⣽⣯⢿⣽⡾⣟⣿⣻⣟⣯⣿⣟⣿⢿⣻⣽⢿⣽⣯⢿⣽⣶⡶⣦⣄⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⢠⡶⣟⡯⢟⠫⠩⢙⠨⠩⠩⠩⡉⡋⠍⠩⠩⢙⠨⠩⢉⠋⠍⠍⠍⠣⢙⠩⢙⠨⠛⠯⣿⣽⣦⡄⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⣰⣿⡻⡋⠌⡐⠠⢑⠐⠨⠈⠌⡐⠠⢂⠡⠁⠅⡂⠌⡨⠐⠨⢈⠌⠨⢈⠄⡂⢂⠂⠅⡂⠄⠝⡾⣟⣆⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⣸⣯⡷⢁⠂⠅⠂⠅⡂⠌⠌⠌⡂⠌⡨⠠⠨⠨⢐⠠⠡⠠⠡⢁⠢⠨⢈⢐⠠⢂⠡⠨⢐⠠⠡⠡⠘⣟⣿⡆⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⣿⣞⡇⠂⠅⢊⠨⢐⠠⠑⠨⢐⠠⠡⢐⠨⠠⡁⠢⠨⠐⡁⠅⡂⠌⠄⠅⡂⠌⠄⠌⡐⡐⠨⠠⢑⠐⣸⢷⣿⠀⠀⠀⠀⠀
⠀⢠⣴⢾⣾⣻⣽⡇⠡⢁⠢⠨⠐⡈⣌⣬⣤⣦⣅⡂⠌⡐⠠⢑⠨⢐⠠⢁⢂⠡⢈⣦⢦⣬⣦⣁⢂⠂⠅⠡⠂⡂⢼⢿⣽⣾⣶⣦⣀⠀
⣰⣿⣻⢏⢏⣿⢾⡇⠨⢐⠠⢁⠅⣾⣻⣯⡿⣾⣻⣽⡔⢈⠌⠄⡂⡂⠌⡐⠠⢨⣿⢾⣿⣻⣾⣻⣦⠊⡨⠨⢐⠐⣸⡿⣷⢝⡺⡷⣟⣆
⣷⣟⣇⢇⡳⣟⣿⡃⠅⡂⠌⡐⠨⣿⣽⢾⣻⣯⣿⣽⡇⠂⡂⠡⢐⠠⢁⠂⠅⢻⣽⣟⣷⣟⣷⢿⣽⢂⠂⢌⠐⡐⢸⣟⣯⡳⡸⣸⡿⣷
⢾⣯⡧⡣⡺⣯⡿⡇⢂⢂⢁⠂⠅⠻⣾⣟⣯⣷⢿⠾⠁⠌⠄⡑⢐⢈⢐⠨⢈⠘⢯⣿⣳⣿⡽⣿⠝⠠⠨⠐⡈⠄⣹⣯⣿⡪⡪⣺⣟⣿
⢹⣷⢷⣕⢭⣷⢿⡇⢂⢐⠐⠨⢈⠔⢈⢊⢋⢙⠩⠐⡁⠅⡁⡂⠅⡐⠄⠌⡐⠨⠠⢉⢙⠘⠍⡂⠌⠌⡐⡁⠂⠅⣸⡾⣷⡣⣓⣾⣯⠏
⠀⠙⠿⣽⢿⣽⣟⡇⡐⡐⠨⠨⠐⡈⡐⡀⠢⢐⠨⢐⠠⢁⢂⢂⠡⢐⠨⢐⠨⠈⠄⠅⢂⠡⠡⠠⢁⠊⠄⡂⠅⡡⢸⣟⣯⡿⣟⠷⠋⠀
⠀⠀⠀⠀⠀⣿⡾⡇⡐⠄⡑⠨⢐⠐⡐⢈⠌⠠⠂⡂⣼⣖⣶⣲⣼⣴⢶⣖⣶⣥⠡⢁⠢⠨⠠⢑⠠⢁⢂⢂⠡⢐⢸⡿⣽⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⢫⣿⣧⢂⠡⢐⢁⠢⢈⢐⠐⡈⠌⡐⠄⡑⡙⡑⠋⠝⡊⡋⡋⠝⠨⢐⠐⠨⠠⢑⠠⠨⢐⠠⠂⠌⣐⣼⡿⡏⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⢳⢿⣳⣌⠠⢂⢐⠡⢐⠈⠄⠅⢂⢁⠂⠔⠠⠡⠡⢐⢀⠂⠅⡁⠢⠨⠨⢈⠄⠌⡐⡐⠄⠅⡥⣾⢷⠟⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠙⢿⣽⢷⣴⣄⣂⣢⣨⣨⣈⣐⣐⣨⣈⣌⣐⣁⣂⣂⣌⣂⣌⣌⣐⣁⣂⣌⣐⣐⣤⢵⡾⣟⡿⠋⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⠛⠷⣟⣿⣽⣯⣿⣽⣟⡿⣯⣿⣻⣟⣿⣻⢿⣽⢿⣽⢿⣽⣟⣿⢯⣿⢯⡿⠻⠛⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠐⣿⣻⣾⣻⡾⣯⣿⣻⣽⢿⣽⣟⠆⠀⡀⠁⠀⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢀⣤⡶⣾⣻⡿⣿⢿⡿⣿⢿⣻⣽⣾⢯⣿⣻⡾⣯⣿⣻⢷⣟⣿⣟⣿⢿⡿⣿⣻⡷⣶⢤⡀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⢠⣼⣟⡷⠟⡙⠩⢐⠐⡐⢐⠐⡐⡐⠠⢐⢐⢀⠂⠔⠠⡀⡂⢂⠂⠄⡂⡐⢐⠐⡈⠍⢋⠻⣟⣿⣦⡄⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⣴⡿⡯⠋⠄⠡⢂⠡⠂⠌⡐⠄⠅⢂⢐⢁⢂⠂⠔⠨⠨⢐⠐⡠⠡⠨⢐⠐⡠⢁⢂⠂⠅⡂⢂⢂⠙⡾⣟⣦⠀⠀⠀⠀⠀
⠀⠀⠀⠀⣼⢿⡝⠅⠡⢁⠅⡂⠌⡨⢐⠠⠡⠨⢐⠠⢂⢐⠨⠈⠔⡁⢂⢂⠂⢌⢐⢐⠨⠐⡀⠢⠨⢐⠠⠡⢐⢐⠨⢻⣟⡧⠀⠀⠀⠀
⠀⠀⠀⢠⣿⣻⡡⣁⣑⣐⣐⡠⣁⣂⢔⣈⣐⣁⣂⢌⢄⣂⢌⡨⣐⡠⡡⣐⡨⣐⣀⣂⣂⢅⢌⡨⣐⣐⢨⣐⣐⡠⡨⡘⣟⣿⡄⠀⠀⠀
⠀⠀⠀⠸⡷⣟⡿⣯⢿⡾⡷⡿⣯⣟⣯⢿⣳⡿⣽⣟⣿⢽⣟⡿⣯⢿⣻⣯⢿⣽⢾⣻⡾⣟⣿⣻⣽⡾⣟⣷⢿⡽⣿⣻⣟⣷⠇⠀⠀⠀`;

export function interactiveHelp(): string {
  return [
    "Commands:",
    "  /help       Show this help",
    "  /status     Show socket, server, and session status",
    "  /context    Show current context usage by item kind",
    "  /compact    Compact older context and report the change",
    "  /lite       Aggressively compact older context and report the change",
    "  /init       Show latest session initialization details",
    "  /events     Show recent runtime event types",
    "  /login      Change Google, GitHub, current, or default user login",
    "  /session    List sessions for this workspace",
    "  /restoreSession Restore a session by id or list number",
    "  /deleteSession  Delete a saved session for this workspace",
    "  /interrupt  Ask the session server to interrupt the active turn",
    "  /exit       Leave ndx",
    "",
    "Everything else is sent to the session server as a user turn.",
  ].join("\n");
}

function formatDeleteSessionChoices(
  cwd: string,
  sessions: SessionListEntry[],
): string {
  return [
    `delete sessions for ${cwd}`,
    ...sessions.map((session) =>
      [
        `${session.number}. ${session.title}`,
        `id: ${session.id}`,
        `updated: ${new Date(session.updatedAt).toISOString()}`,
        session.live ? "live" : "saved",
      ].join(" | "),
    ),
    "Press Enter without a number to cancel.",
  ].join("\n");
}

function parseSlashCommand(
  input: string,
): { name: string; args: string | undefined } | undefined {
  const command = input.trim();
  if (!command.startsWith("/") || command === "/") {
    return undefined;
  }
  const body = command.slice(1);
  const firstSpace = body.search(/\s/);
  if (firstSpace === -1) {
    return { name: body, args: undefined };
  }
  const name = body.slice(0, firstSpace);
  const args = body.slice(firstSpace).trim();
  return { name, args: args.length > 0 ? args : undefined };
}

export function runtimeEvent(
  notification: SessionNotification,
): RuntimeEventMsg | undefined {
  if (notification.params === null || typeof notification.params !== "object") {
    return undefined;
  }
  const event = (notification.params as { event?: unknown }).event;
  if (event === null || typeof event !== "object") {
    return undefined;
  }
  return event as RuntimeEventMsg;
}

function formatInitializeResult(
  result: InitializeResult,
  includeServerInfo = true,
): string {
  const lines: string[] = [];
  if (includeServerInfo) {
    lines.push(formatServerInfo(result));
  }
  const methods = result.methods?.join(", ") ?? "none";
  lines.push(`[methods] ${methods}`, formatBootstrap(result.bootstrap));
  return lines.join("\n");
}

function formatServerInfo(result: ServerInfoResult): string {
  const server = result.server ?? "unknown";
  const version = result.version ?? "unknown";
  const protocol = result.protocolVersion ?? "unknown";
  const dashboard = result.dashboardUrl ?? "unknown";
  const runtime = result.runtime;
  const runtimeKind = runtime?.kind ?? "unknown";
  const node = runtime?.node ?? "unknown-node";
  const platform = [runtime?.platform, runtime?.arch].filter(Boolean).join("/");
  const sandbox = result.toolSandbox;
  const sandboxKind = sandbox?.kind ?? "unknown";
  const sandboxImage = sandbox?.image ?? "unknown-image";
  const workspaceMount = sandbox?.workspaceMount ?? "/workspace";
  const globalMount = sandbox?.globalMount ?? "/home/.ndx";
  return [
    "[socket] connected",
    `[session-server] ${server} ${version}`,
    `[server-runtime] ${runtimeKind} ${node}${platform.length > 0 ? ` (${platform})` : ""}`,
    `[tool-sandbox] ${sandboxKind} ${sandboxImage} (${workspaceMount}, ${globalMount})`,
    `[dashboard] ${dashboard}`,
    `[protocol] ${protocol}`,
  ].join("\n");
}

function isServerInfoResult(value: unknown): value is ServerInfoResult {
  return value !== null && typeof value === "object";
}

function formatSessionStarted(session: SessionSummary): string {
  return [
    `[session] ${session.id}`,
    `[number] ${session.number ?? "empty"}`,
    `[title] ${session.title ?? "empty"}`,
    `[cwd] ${session.cwd}`,
    `[model] ${session.model}`,
    `[status] ${session.status}`,
  ].join("\n");
}

function formatSessionChoices(
  cwd: string,
  sessions: SessionListEntry[],
): string {
  return [
    `sessions for ${cwd}`,
    "0. new session",
    ...sessions.map((session) =>
      [
        `${session.number}. ${session.title}`,
        `id: ${session.id}`,
        `updated: ${new Date(session.updatedAt).toISOString()}`,
        session.live ? "live" : "saved",
      ].join(" | "),
    ),
  ].join("\n");
}

function formatSessionConfigured(
  event: SessionConfiguredEvent,
  initializedBootstrapGlobalDir?: string,
): string {
  const sources =
    event.sources.length === 0 ? "none" : event.sources.join(", ");
  return [
    "[session-init]",
    `  session: ${event.sessionId}`,
    `  cwd: ${event.cwd}`,
    `  model: ${event.model}`,
    `  approval: ${event.approvalPolicy}`,
    `  sandbox: ${event.sandboxMode}`,
    `  context: ${formatContext(event.context)}`,
    `  sources: ${sources}`,
    initializedBootstrapGlobalDir === event.bootstrap.globalDir
      ? `[bootstrap] already initialized for ${event.bootstrap.globalDir}`
      : formatBootstrap(event.bootstrap),
  ].join("\n");
}

function formatBootstrap(bootstrap: NdxBootstrapReport | undefined): string {
  if (bootstrap === undefined) {
    return "[bootstrap] unavailable";
  }
  const installed = bootstrap.elements.filter(
    (element) => element.status === "installed",
  );
  const existing = bootstrap.elements.length - installed.length;
  const rows = summarizedBootstrapRows(bootstrap);
  return [
    `[bootstrap] ${bootstrap.globalDir}`,
    `  installed: ${installed.length}`,
    `  existing: ${existing}`,
    ...rows,
  ].join("\n");
}

interface StartupLoginChoice {
  key: string;
  label: string;
  action: "default" | "previous" | "google";
  login: StoredLogin;
}

function startupLoginChoices(login: StoredLogin): StartupLoginChoice[] {
  const choices: StartupLoginChoice[] = [];
  let key = 1;
  choices.push({
    key: String(key),
    label: "Use default user (defaultUser)",
    action: "default",
    login: defaultLogin(),
  });
  key += 1;
  if (login.kind !== "default") {
    choices.push({
      key: String(key),
      label: `Continue previous login (${describeLogin(login)})`,
      action: "previous",
      login,
    });
    key += 1;
  }
  choices.push({
    key: String(key),
    label: "New Google login",
    action: "google",
    login,
  });
  return choices;
}

function formatStartupLoginChoice(choice: StartupLoginChoice): string {
  return `${choice.key}. ${choice.label}`;
}

function describeLogin(login: StoredLogin): string {
  if (login.kind === "default") {
    return "defaultUser";
  }
  if (login.kind === "social") {
    const suffix =
      login.displayName !== undefined || login.email !== undefined
        ? ` ${[login.displayName, login.email].filter(Boolean).join(" ")}`
        : "";
    return `${login.username}${suffix}`;
  }
  return login.username;
}

function formatContext(
  context: SessionConfiguredEvent["context"] | undefined,
): string {
  if (context === undefined) {
    return "restored 0 items, token estimate unavailable";
  }
  if (context.maxContextTokens === undefined) {
    return `restored ${context.restoredItems} items, ${context.estimatedTokens}/unknown tokens`;
  }
  const percent =
    context.maxContextTokens <= 0
      ? 0
      : (context.estimatedTokens / context.maxContextTokens) * 100;
  return `restored ${context.restoredItems} items, ${context.estimatedTokens}/${context.maxContextTokens} tokens (${percent.toFixed(1)}%)`;
}

function summarizedBootstrapRows(bootstrap: NdxBootstrapReport): string[] {
  const byName = new Map(
    bootstrap.elements.map((element) => [element.name, element]),
  );
  const used = new Set<string>();
  const rows: string[] = [];
  for (const element of bootstrap.elements) {
    if (used.has(element.name)) {
      continue;
    }
    if (element.name.endsWith(" tool")) {
      const base = element.name.slice(0, -" tool".length);
      const manifest = byName.get(`${base} manifest`);
      const runtime = byName.get(`${base} runtime`);
      used.add(element.name);
      used.add(`${base} manifest`);
      used.add(`${base} runtime`);
      rows.push(
        `  ${element.status}: ${base} tool (${element.path}; manifest: ${manifest?.status ?? "missing"}, runtime: ${runtime?.status ?? "missing"})`,
      );
      continue;
    }
    if (
      element.name.endsWith(" manifest") ||
      element.name.endsWith(" runtime")
    ) {
      continue;
    }
    used.add(element.name);
    rows.push(`  ${element.status}: ${element.name} (${element.path})`);
  }
  return rows;
}
