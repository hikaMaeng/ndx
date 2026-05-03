export type CommandPlacement = "session-builtin" | "core-candidate";

export interface SlashCommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  placement: CommandPlacement;
  implemented: boolean;
}

export interface SlashCommandExecution {
  name: string;
  args?: string;
  sessionId?: string;
  cwd?: string;
}

export type SlashCommandResult =
  | { handled: true; action: "print"; output: string }
  | {
      handled: true;
      action: "restore";
      output: string;
      session: unknown;
    }
  | {
      handled: true;
      action: "deleteSession";
      output: string;
    }
  | { handled: true; action: "exit"; output?: string }
  | { handled: false; output: string };

const ORIGIN_COMMANDS: SlashCommandDefinition[] = [
  implementedBuiltin("model", "choose what model and reasoning effort to use"),
  implementedBuiltin("effort", "choose the active model reasoning effort"),
  implementedBuiltin("think", "choose whether model thinking mode is on"),
  builtin(
    "fast",
    "toggle Fast mode to enable fastest inference with increased plan usage",
  ),
  builtin("approvals", "choose what Codex is allowed to do"),
  builtin("permissions", "choose what Codex is allowed to do"),
  builtin("setup-default-sandbox", "set up elevated agent sandbox"),
  builtin(
    "sandbox-add-read-dir",
    "let sandbox read a directory: /sandbox-add-read-dir <absolute_path>",
  ),
  builtin("experimental", "toggle experimental features"),
  builtin("memories", "configure memory use and generation"),
  candidate(
    "skills",
    "use skills to improve how Codex performs specific tasks",
  ),
  builtin("review", "review my current changes and find issues"),
  builtin("rename", "rename the current session"),
  builtin("new", "start a new chat during a conversation"),
  builtin("resume", "resume a saved chat"),
  builtin("fork", "fork the current chat"),
  candidate("init", "create an AGENTS.md file with instructions for Codex"),
  builtin("compact", "compact saved context and report before/after usage"),
  implementedBuiltin("lite", "toggle lite context mode and report usage"),
  builtin("plan", "switch to Plan mode"),
  builtin("goal", "set or view the goal for a long-running task"),
  builtin("collab", "change collaboration mode (experimental)"),
  builtin("agent", "switch the active agent session"),
  builtin("side", "start a side conversation in an ephemeral fork"),
  candidate("copy", "copy last response as markdown"),
  candidate("diff", "show git diff (including untracked files)"),
  candidate("mention", "mention a file"),
  candidate("status", "show current session configuration and token usage"),
  builtin(
    "debug-config",
    "show config layers and requirement sources for debugging",
  ),
  builtin("title", "configure which items appear in the terminal title"),
  builtin("statusline", "configure which items appear in the status line"),
  builtin("theme", "choose a syntax highlighting theme"),
  candidate("mcp", "list configured MCP tools; use /mcp verbose for details"),
  candidate("apps", "manage apps"),
  candidate("plugins", "browse plugins"),
  builtin("logout", "log out of Codex"),
  builtin("quit", "exit Codex", ["exit"]),
  builtin("feedback", "send logs to maintainers"),
  builtin("rollout", "print the rollout file path"),
  candidate("ps", "list background terminals"),
  candidate("stop", "stop all background terminals", ["clean"]),
  builtin("clear", "clear the terminal and start a new chat"),
  builtin("personality", "choose a communication style for Codex"),
  builtin("realtime", "toggle realtime voice mode (experimental)"),
  builtin("settings", "configure realtime microphone/speaker"),
  builtin("test-approval", "test approval request"),
  builtin("subagents", "switch the active agent session"),
  builtin("debug-m-drop", "DO NOT USE"),
  builtin("debug-m-update", "DO NOT USE"),
];

const NDX_SESSION_COMMANDS: SlashCommandDefinition[] = [
  {
    name: "help",
    description: "show session-server slash commands",
    placement: "session-builtin",
    implemented: true,
  },
  {
    name: "events",
    description: "show recent runtime event types for the current session",
    placement: "session-builtin",
    implemented: true,
  },
  {
    name: "login",
    description: "change Google, GitHub, current, or default user login",
    placement: "session-builtin",
    implemented: true,
  },
  {
    name: "session",
    description: "list sessions for the current workspace",
    placement: "session-builtin",
    implemented: true,
  },
  {
    name: "restoreSession",
    description: "restore a saved session by id or workspace session number",
    placement: "session-builtin",
    implemented: true,
  },
  {
    name: "deleteSession",
    description: "delete a saved session for the current workspace",
    placement: "session-builtin",
    implemented: true,
  },
  {
    name: "interrupt",
    description: "ask the session server to interrupt the active turn",
    placement: "session-builtin",
    implemented: true,
  },
  {
    name: "context",
    description: "show current context usage by item kind",
    placement: "session-builtin",
    implemented: true,
  },
];

export const BUILT_IN_SLASH_COMMANDS: SlashCommandDefinition[] = [
  ...NDX_SESSION_COMMANDS,
  ...ORIGIN_COMMANDS.map(
    (command): SlashCommandDefinition =>
      ["compact", "init", "status", "quit"].includes(command.name)
        ? { ...command, placement: "session-builtin", implemented: true }
        : command,
  ),
];

const COMMANDS_BY_NAME = new Map<string, SlashCommandDefinition>();
for (const command of BUILT_IN_SLASH_COMMANDS) {
  COMMANDS_BY_NAME.set(command.name, command);
  for (const alias of command.aliases ?? []) {
    COMMANDS_BY_NAME.set(alias, command);
  }
}

export function resolveSlashCommand(
  name: string,
): SlashCommandDefinition | undefined {
  return COMMANDS_BY_NAME.get(name);
}

export function formatSlashCommandHelp(): string {
  const rows = BUILT_IN_SLASH_COMMANDS.filter((command) => command.implemented)
    .map((command) => `  /${command.name.padEnd(10)} ${command.description}`)
    .join("\n");
  return [
    "Commands:",
    rows,
    "",
    "Everything else is sent to the session server as a user turn.",
  ].join("\n");
}

function builtin(
  name: string,
  description: string,
  aliases?: string[],
): SlashCommandDefinition {
  return {
    name,
    aliases,
    description,
    placement: "session-builtin",
    implemented: false,
  };
}

function implementedBuiltin(
  name: string,
  description: string,
  aliases?: string[],
): SlashCommandDefinition {
  return {
    name,
    aliases,
    description,
    placement: "session-builtin",
    implemented: true,
  };
}

function candidate(
  name: string,
  description: string,
  aliases?: string[],
): SlashCommandDefinition {
  return {
    name,
    aliases,
    description,
    placement: "core-candidate",
    implemented: false,
  };
}
