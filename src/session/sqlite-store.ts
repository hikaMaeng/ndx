import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { ModelConversationItem } from "../model/types.js";
import type { RuntimeEvent } from "../shared/protocol.js";

type DatabaseSync = {
  exec(sql: string): void;
  prepare(sql: string): StatementSync;
  close(): void;
};

type StatementSync = {
  all(...values: unknown[]): unknown[];
  get(...values: unknown[]): unknown;
  run(...values: unknown[]): { changes: number; lastInsertRowid: number };
};

export type StoredSessionStatus = "idle" | "running" | "aborted" | "failed";

export interface StoredSession {
  id: string;
  user: string;
  cwd: string;
  status: StoredSessionStatus;
  createdAt: number;
  updatedAt: number;
  events: RuntimeEvent[];
  sequence: number;
  title: string;
}

export interface StoredSessionContext {
  events: RuntimeEvent[];
  items: ModelConversationItem[];
  liteEnabled: boolean;
  compactEventId?: number;
}

export interface StoredSessionListEntry {
  id: string;
  user: string;
  cwd: string;
  status: StoredSessionStatus;
  createdAt: number;
  updatedAt: number;
  eventCount: number;
  sequence: number;
  title: string;
}

export interface ContextModeState {
  liteEnabled: boolean;
  compactEventId?: number;
  updatedAt?: number;
}

interface ModelContextReadOptions {
  liteEnabled?: boolean;
  pruneToolLogsForNewUserTurn?: boolean;
}

export interface CompactSessionResult {
  summary: string;
  eventId: number;
  compactedAt: number;
}

interface ContextEventRow {
  eventId: number;
  itemSeq: number;
  payload: string;
}

interface RuntimeEventRow {
  id: number;
  payload: string;
  msgType?: string;
  turnId?: string;
}

const CONTEXT_PARTITION_COUNT = 16;

export interface DashboardSessionLogFilters {
  accounts: string[];
  projects: string[];
  sessions: string[];
}

export interface DashboardSessionLogFacets {
  accounts: string[];
  projects: string[];
  sessions: Array<{
    id: string;
    user: string;
    cwd: string;
    sequence: number;
    title: string;
  }>;
}

export interface DashboardSessionLogEntry extends StoredSessionListEntry {
  lastEventId?: number;
  lastTurnId?: string;
}

export interface DashboardSessionLogEvent {
  id: number;
  sessionId: string;
  type: string;
  msgType?: string;
  turnId?: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface DashboardSessionLogEventPage {
  session: DashboardSessionLogEntry;
  events: DashboardSessionLogEvent[];
  offset: number;
  limit: number;
  total: number;
}

/** SQLite-backed durable state for ndx server accounts and sessions. */
export class SqliteSessionStore {
  private readonly db: DatabaseSync;
  readonly dbFile: string;

  private constructor(db: DatabaseSync, dbFile: string) {
    this.db = db;
    this.dbFile = dbFile;
    this.initialize();
  }

  static open(dataDir: string): SqliteSessionStore {
    mkdirSync(dataDir, { recursive: true });
    const require = createRequire(import.meta.url);
    const sqlite = require("node:sqlite") as {
      DatabaseSync: new (path: string) => DatabaseSync;
    };
    return new SqliteSessionStore(
      new sqlite.DatabaseSync(join(dataDir, "ndx.sqlite")),
      join(dataDir, "ndx.sqlite"),
    );
  }

  close(): void {
    this.db.close();
  }

  createAccount(username: string, password: string): number {
    const now = Date.now();
    this.db
      .prepare(
        "insert into users (id, username, password, created_at, updated_at) values (?, ?, ?, ?, ?)",
      )
      .run(username, username, password, now, now);
    return now;
  }

  accountExists(username: string): boolean {
    return (
      this.db
        .prepare("select 1 from users where username = ?")
        .get(username) !== undefined
    );
  }

  validateAccount(username: string, password: string): boolean {
    const row = this.db
      .prepare("select password from users where username = ?")
      .get(username) as { password?: unknown } | undefined;
    return typeof row?.password === "string" && row.password === password;
  }

  deleteAccount(username: string): boolean {
    return (
      this.db
        .prepare("delete from users where username = ? and username <> ?")
        .run(username, "defaultUser").changes > 0
    );
  }

  changePassword(
    username: string,
    oldPassword: string,
    newPassword: string,
  ): number {
    if (!this.validateAccount(username, oldPassword)) {
      throw new Error("invalid account credentials");
    }
    const now = Date.now();
    this.db
      .prepare(
        "update users set password = ?, updated_at = ? where username = ?",
      )
      .run(newPassword, now, username);
    return now;
  }

  upsertSocialAccount(input: {
    provider: string;
    subject: string;
    email?: string;
    displayName?: string;
    accessToken?: string;
    refreshToken?: string;
  }): { username: string; updatedAt: number; created: boolean } {
    const username = `${input.provider}:${input.subject}`;
    const now = Date.now();
    let created = false;
    this.transaction(() => {
      if (!this.accountExists(username)) {
        this.createAccount(username, "");
        created = true;
      }
      this.db
        .prepare(
          [
            "insert into oauth_accounts",
            "(provider, subject, user_id, email, display_name, access_token, refresh_token, updated_at)",
            "values (?, ?, ?, ?, ?, ?, ?, ?)",
            "on conflict(provider, subject) do update set",
            "email = excluded.email, display_name = excluded.display_name,",
            "access_token = excluded.access_token, refresh_token = excluded.refresh_token,",
            "updated_at = excluded.updated_at",
          ].join(" "),
        )
        .run(
          input.provider,
          input.subject,
          username,
          input.email ?? null,
          input.displayName ?? null,
          input.accessToken ?? null,
          input.refreshToken ?? null,
          now,
        );
    });
    return { username, updatedAt: now, created };
  }

  createSession(input: {
    id: string;
    user: string;
    cwd: string;
    title: string;
    status: StoredSessionStatus;
    model: string;
    createdAt: number;
  }): number {
    return this.transaction(() => {
      this.ensureProject(input.user, input.cwd, input.createdAt);
      const project = projectId(input.user, input.cwd);
      const sequence = this.claimNextSequence(project);
      this.db
        .prepare(
          [
            "insert into sessions",
            "(id, user_id, project_id, sequence, title, status, model, created_at, updated_at)",
            "values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ].join(" "),
        )
        .run(
          input.id,
          input.user,
          project,
          sequence,
          input.title,
          input.status,
          input.model,
          input.createdAt,
          input.createdAt,
        );
      this.insertEvent(input.id, "session_started", undefined, {
        type: "session_started",
        sessionId: input.id,
        user: input.user,
        cwd: input.cwd,
        sequence,
        title: input.title,
        createdAt: input.createdAt,
      });
      return sequence;
    });
  }

  appendRecord(
    sessionId: string,
    type: string,
    record: Record<string, unknown>,
  ) {
    this.transaction(() => {
      const eventId = this.insertEvent(
        sessionId,
        type,
        runtimeEvent(record),
        record,
      );
      this.insertContextItem(sessionId, eventId, record);
      this.applySessionMutation(sessionId, type, eventId, record);
    });
  }

  listSessions(user: string, cwd: string): StoredSessionListEntry[] {
    const rows = this.db
      .prepare(
        [
          "select s.id, s.user_id as user, p.cwd, s.status, s.created_at as createdAt,",
          "s.updated_at as updatedAt, s.sequence, s.title, s.event_count as eventCount",
          "from sessions s join projects p on p.id = s.project_id",
          "where s.user_id = ? and p.cwd = ? and s.deleted_at is null",
          "order by s.sequence asc",
        ].join(" "),
      )
      .all(user, cwd) as StoredSessionListEntry[];
    return rows;
  }

  readSession(sessionId: string): StoredSession | undefined {
    const row = this.db
      .prepare(
        [
          "select s.id, s.user_id as user, p.cwd, s.status, s.created_at as createdAt,",
          "s.updated_at as updatedAt, s.sequence, s.title",
          "from sessions s join projects p on p.id = s.project_id",
          "where s.id = ? and s.deleted_at is null",
        ].join(" "),
      )
      .get(sessionId) as Omit<StoredSession, "events"> | undefined;
    if (row === undefined) {
      return undefined;
    }
    return {
      ...row,
      events: this.runtimeEvents(sessionId),
    };
  }

  readSessions(): StoredSession[] {
    const rows = this.db
      .prepare(
        [
          "select s.id, s.user_id as user, p.cwd, s.status, s.created_at as createdAt,",
          "s.updated_at as updatedAt, s.sequence, s.title",
          "from sessions s join projects p on p.id = s.project_id",
          "where s.deleted_at is null",
          "order by s.created_at asc",
        ].join(" "),
      )
      .all() as Array<Omit<StoredSession, "events">>;
    return rows.map((row) => ({
      ...row,
      events: this.runtimeEvents(row.id),
    }));
  }

  dashboardSessionLogFacets(): DashboardSessionLogFacets {
    const accounts = this.db
      .prepare(
        [
          "select distinct s.user_id as user",
          "from sessions s",
          "where s.deleted_at is null",
          "order by s.user_id asc",
        ].join(" "),
      )
      .all()
      .map((row) => (row as { user: string }).user);
    const projects = this.db
      .prepare(
        [
          "select distinct p.cwd",
          "from sessions s join projects p on p.id = s.project_id",
          "where s.deleted_at is null",
          "order by p.cwd asc",
        ].join(" "),
      )
      .all()
      .map((row) => (row as { cwd: string }).cwd);
    const sessions = this.db
      .prepare(
        [
          "select s.id, s.user_id as user, p.cwd, s.sequence, s.title",
          "from sessions s join projects p on p.id = s.project_id",
          "where s.deleted_at is null",
          "order by s.created_at asc",
        ].join(" "),
      )
      .all() as DashboardSessionLogFacets["sessions"];
    return { accounts, projects, sessions };
  }

  listDashboardSessionLogs(
    filters: DashboardSessionLogFilters,
  ): DashboardSessionLogEntry[] {
    const where = ["s.deleted_at is null"];
    const values: unknown[] = [];
    addInFilter(where, values, "s.user_id", filters.accounts);
    addInFilter(where, values, "p.cwd", filters.projects);
    addInFilter(where, values, "s.id", filters.sessions);
    return this.db
      .prepare(
        [
          "select s.id, s.user_id as user, p.cwd, s.status, s.created_at as createdAt,",
          "s.updated_at as updatedAt, s.sequence, s.title, s.event_count as eventCount,",
          "s.last_event_id as lastEventId, s.last_turn_id as lastTurnId",
          "from sessions s join projects p on p.id = s.project_id",
          `where ${where.join(" and ")}`,
          "order by s.created_at asc",
        ].join(" "),
      )
      .all(...values) as DashboardSessionLogEntry[];
  }

  readDashboardSessionLogEvents(
    sessionId: string,
    offset: number,
    limit: number,
  ): DashboardSessionLogEventPage | undefined {
    const session = this.dashboardSessionById(sessionId);
    if (session === undefined) {
      return undefined;
    }
    const totalRow = this.db
      .prepare(
        "select count(1) as total from session_events where session_id = ?",
      )
      .get(sessionId) as { total?: unknown } | undefined;
    const total = typeof totalRow?.total === "number" ? totalRow.total : 0;
    const rows = this.db
      .prepare(
        [
          "select id, session_id as sessionId, type, msg_type as msgType,",
          "turn_id as turnId, payload_json as payloadJson, created_at as createdAt",
          "from session_events",
          "where session_id = ?",
          "order by id asc",
          "limit ? offset ?",
        ].join(" "),
      )
      .all(sessionId, limit, offset) as Array<{
      id: number;
      sessionId: string;
      type: string;
      msgType?: string | null;
      turnId?: string | null;
      payloadJson: string;
      createdAt: number;
    }>;
    return {
      session,
      events: rows.map((row) => ({
        id: row.id,
        sessionId: row.sessionId,
        type: row.type,
        msgType: row.msgType ?? undefined,
        turnId: row.turnId ?? undefined,
        payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
        createdAt: row.createdAt,
      })),
      offset,
      limit,
      total,
    };
  }

  dashboardSessionById(
    sessionId: string,
  ): DashboardSessionLogEntry | undefined {
    return this.db
      .prepare(
        [
          "select s.id, s.user_id as user, p.cwd, s.status, s.created_at as createdAt,",
          "s.updated_at as updatedAt, s.sequence, s.title, s.event_count as eventCount,",
          "s.last_event_id as lastEventId, s.last_turn_id as lastTurnId",
          "from sessions s join projects p on p.id = s.project_id",
          "where s.id = ? and s.deleted_at is null",
        ].join(" "),
      )
      .get(sessionId) as DashboardSessionLogEntry | undefined;
  }

  readSessionContext(sessionId: string): StoredSessionContext | undefined {
    if (!this.sessionExists(sessionId)) {
      return undefined;
    }
    const state = this.contextModeState(sessionId);
    const events = this.contextEvents(sessionId, state);
    return {
      events,
      items: this.modelContextItems(sessionId, state),
      liteEnabled: state.liteEnabled,
      compactEventId: state.compactEventId,
    };
  }

  setLiteMode(sessionId: string, enabled: boolean): ContextModeState {
    if (!this.sessionExists(sessionId)) {
      throw new Error(`unknown session: ${sessionId}`);
    }
    const now = Date.now();
    this.db
      .prepare(
        [
          "insert into session_context_state",
          "(session_id, lite_enabled, updated_at)",
          "values (?, ?, ?)",
          "on conflict(session_id) do update set",
          "lite_enabled = excluded.lite_enabled, updated_at = excluded.updated_at",
        ].join(" "),
      )
      .run(sessionId, enabled ? 1 : 0, now);
    return this.contextModeState(sessionId);
  }

  readModelContext(
    sessionId: string,
    options?: ModelContextReadOptions,
  ): ModelConversationItem[] {
    if (!this.sessionExists(sessionId)) {
      return [];
    }
    const state = {
      ...this.contextModeState(sessionId),
      ...(options?.liteEnabled === undefined
        ? {}
        : { liteEnabled: options.liteEnabled }),
    };
    return this.modelContextItems(sessionId, state, options);
  }

  compactSession(sessionId: string): CompactSessionResult {
    if (!this.sessionExists(sessionId)) {
      throw new Error(`unknown session: ${sessionId}`);
    }
    return this.transaction(() => {
      const state = this.contextModeState(sessionId);
      const summary = this.buildCompactSummary(sessionId, state.compactEventId);
      const compactedAt = Date.now();
      const eventId = this.insertEvent(
        sessionId,
        "context_compact",
        undefined,
        {
          type: "context_compact",
          sessionId,
          previousCompactEventId: state.compactEventId ?? null,
          summary,
          compactedAt,
        },
      );
      this.db
        .prepare(
          [
            "insert into session_context_state",
            "(session_id, lite_enabled, compact_event_id, updated_at)",
            "values (?, ?, ?, ?)",
            "on conflict(session_id) do update set",
            "compact_event_id = excluded.compact_event_id, updated_at = excluded.updated_at",
          ].join(" "),
        )
        .run(sessionId, state.liteEnabled ? 1 : 0, eventId, compactedAt);
      return { summary, eventId, compactedAt };
    });
  }

  deleteSession(sessionId: string): void {
    this.db
      .prepare(
        "update sessions set deleted_at = ?, updated_at = ? where id = ?",
      )
      .run(Date.now(), Date.now(), sessionId);
    this.db
      .prepare("delete from session_owners where session_id = ?")
      .run(sessionId);
  }

  sessionExists(sessionId: string): boolean {
    return (
      this.db
        .prepare("select 1 from sessions where id = ? and deleted_at is null")
        .get(sessionId) !== undefined
    );
  }

  claimOwner(sessionId: string, serverId: string): void {
    const now = Date.now();
    this.db
      .prepare(
        [
          "insert into session_owners (session_id, server_id, claimed_at)",
          "values (?, ?, ?)",
          "on conflict(session_id) do update set server_id = excluded.server_id, claimed_at = excluded.claimed_at",
        ].join(" "),
      )
      .run(sessionId, serverId, now);
  }

  currentOwner(sessionId: string): string | undefined {
    const row = this.db
      .prepare(
        "select server_id as serverId from session_owners where session_id = ?",
      )
      .get(sessionId) as { serverId?: unknown } | undefined;
    return typeof row?.serverId === "string" ? row.serverId : undefined;
  }

  private initialize(): void {
    this.db.exec("pragma journal_mode = wal");
    this.db.exec("pragma foreign_keys = on");
    this.db.exec("pragma busy_timeout = 5000");
    this.db.exec("pragma synchronous = normal");
    this.db.exec(`
      create table if not exists users (
        id text primary key,
        username text not null unique,
        password text not null,
        created_at integer not null,
        updated_at integer not null
      );
      create table if not exists projects (
        id text primary key,
        user_id text not null references users(id) on delete cascade,
        cwd text not null,
        created_at integer not null,
        next_sequence integer not null default 1,
        unique(user_id, cwd)
      );
      create table if not exists clients (
        id text primary key,
        user_id text not null references users(id) on delete cascade,
        kind text,
        last_seen_at integer not null
      );
      create table if not exists oauth_accounts (
        provider text not null,
        subject text not null,
        user_id text not null references users(id) on delete cascade,
        email text,
        display_name text,
        access_token text,
        refresh_token text,
        updated_at integer not null,
        primary key(provider, subject)
      );
      create table if not exists sessions (
        id text primary key,
        user_id text not null references users(id) on delete cascade,
        project_id text not null references projects(id) on delete cascade,
        sequence integer not null,
        title text not null,
        status text not null,
        model text,
        created_at integer not null,
        updated_at integer not null,
        deleted_at integer,
        event_count integer not null default 0,
        last_event_id integer,
        last_turn_id text,
        unique(user_id, project_id, sequence)
      );
      create table if not exists session_events (
        id integer primary key autoincrement,
        session_id text not null references sessions(id) on delete cascade,
        type text not null,
        msg_type text,
        turn_id text,
        payload_json text not null,
        created_at integer not null
      );
      create table if not exists session_context_items (
        id integer primary key autoincrement,
        session_id text not null references sessions(id) on delete cascade,
        event_id integer not null references session_events(id) on delete cascade,
        item_seq integer not null,
        payload_json text not null,
        created_at integer not null,
        unique(session_id, item_seq)
      );
      create table if not exists session_context_state (
        session_id text primary key references sessions(id) on delete cascade,
        lite_enabled integer not null default 0,
        compact_event_id integer references session_events(id) on delete set null,
        updated_at integer not null
      );
      create table if not exists session_context_segments (
        session_id text primary key references sessions(id) on delete cascade,
        user_id text not null,
        project_id text not null,
        segment_key text not null,
        table_name text not null,
        created_at integer not null
      );
      create table if not exists session_owners (
        session_id text primary key references sessions(id) on delete cascade,
        server_id text not null,
        claimed_at integer not null
      );
    `);
    this.initializeContextPartitions();
    this.migrateProjectionSchema();
    this.db.exec(`
      create index if not exists idx_projects_user_cwd on projects(user_id, cwd);
      create index if not exists idx_sessions_project_sequence_live on sessions(project_id, sequence) where deleted_at is null;
      create index if not exists idx_sessions_user_project_live on sessions(user_id, project_id) where deleted_at is null;
      create index if not exists idx_session_events_session_id on session_events(session_id, id);
      create index if not exists idx_session_events_type on session_events(session_id, type, id);
      create index if not exists idx_session_events_turn on session_events(session_id, turn_id, id);
      create index if not exists idx_session_context_items_session_seq on session_context_items(session_id, item_seq);
      create index if not exists idx_session_context_state_compact on session_context_state(session_id, compact_event_id);
      create index if not exists idx_session_context_segments_user_project on session_context_segments(user_id, project_id);
      create index if not exists idx_session_context_segments_table on session_context_segments(table_name, segment_key);
    `);
    this.backfillProjectionRows();
    if (!this.accountExists("defaultUser")) {
      this.createAccount("defaultUser", "");
    }
  }

  private ensureProject(user: string, cwd: string, now: number): void {
    if (!this.accountExists(user)) {
      this.createAccount(user, "");
    }
    this.db
      .prepare(
        "insert or ignore into projects (id, user_id, cwd, created_at, next_sequence) values (?, ?, ?, ?, 1)",
      )
      .run(projectId(user, cwd), user, cwd, now);
  }

  private claimNextSequence(project: string): number {
    this.db
      .prepare(
        "update projects set next_sequence = next_sequence + 1 where id = ?",
      )
      .run(project);
    const row = this.db
      .prepare(
        "select next_sequence - 1 as sequence from projects where id = ?",
      )
      .get(project) as { sequence?: unknown } | undefined;
    if (typeof row?.sequence !== "number") {
      throw new Error(`missing project sequence row: ${project}`);
    }
    return row.sequence;
  }

  private insertEvent(
    sessionId: string,
    type: string,
    event: RuntimeEvent | undefined,
    payload: Record<string, unknown>,
  ): number {
    const msg = event?.msg;
    const result = this.db
      .prepare(
        "insert into session_events (session_id, type, msg_type, turn_id, payload_json, created_at) values (?, ?, ?, ?, ?, ?)",
      )
      .run(
        sessionId,
        type,
        msg?.type ?? null,
        eventTurnId(event) ?? null,
        JSON.stringify(payload),
        Date.now(),
      );
    return result.lastInsertRowid;
  }

  private insertContextItem(
    sessionId: string,
    eventId: number,
    record: Record<string, unknown>,
  ): void {
    const event = runtimeEvent(record);
    if (event === undefined || !isContextEvent(event)) {
      return;
    }
    const table = this.contextTableForSession(sessionId);
    const row = this.db
      .prepare(
        "select coalesce(max(item_seq), 0) + 1 as next from session_context_items where session_id = ?",
      )
      .get(sessionId) as { next?: unknown } | undefined;
    const next = typeof row?.next === "number" ? row.next : 1;
    this.db
      .prepare(
        "insert into session_context_items (session_id, event_id, item_seq, payload_json, created_at) values (?, ?, ?, ?, ?)",
      )
      .run(sessionId, eventId, next, JSON.stringify(event), Date.now());
    this.db
      .prepare(
        `insert or ignore into ${table} (session_id, event_id, item_seq, payload_json, msg_type, turn_id, created_at) values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        eventId,
        next,
        JSON.stringify(event),
        event.msg.type,
        eventTurnId(event) ?? null,
        Date.now(),
      );
  }

  private applySessionMutation(
    sessionId: string,
    type: string,
    eventId: number,
    record: Record<string, unknown>,
  ): void {
    const updatedAt = recordTimestamp(record);
    if (type === "runtime_event") {
      const event = record.event;
      if (isRuntimeEvent(event)) {
        this.db
          .prepare(
            [
              "update sessions set status = ?, updated_at = ?,",
              "event_count = event_count + 1, last_event_id = ?, last_turn_id = ?",
              "where id = ?",
            ].join(" "),
          )
          .run(
            statusFromEvent(event, undefined),
            updatedAt,
            eventId,
            eventTurnId(event) ?? null,
            sessionId,
          );
      }
      return;
    }
    if (type === "session_detached") {
      const status =
        typeof record.status === "string" ? record.status : undefined;
      if (status !== undefined) {
        this.db
          .prepare(
            "update sessions set status = ?, updated_at = ?, last_event_id = ? where id = ?",
          )
          .run(status, updatedAt, eventId, sessionId);
      }
    }
  }

  private runtimeEvents(sessionId: string): RuntimeEvent[] {
    return this.db
      .prepare(
        "select payload_json as payload from session_events where session_id = ? and type = 'runtime_event' order by id asc",
      )
      .all(sessionId)
      .map((row) => JSON.parse((row as { payload: string }).payload))
      .map((record) => record.event)
      .filter(isRuntimeEvent);
  }

  private contextEvents(
    sessionId: string,
    state: ContextModeState,
  ): RuntimeEvent[] {
    return this.filteredContextRows(sessionId, state, {})
      .map((row) => JSON.parse(row.payload))
      .filter(isRuntimeEvent);
  }

  private modelContextItems(
    sessionId: string,
    state: ContextModeState,
    options?: ModelContextReadOptions,
  ): ModelConversationItem[] {
    const items: ModelConversationItem[] = [];
    const compact = this.compactRecord(sessionId, state.compactEventId);
    if (compact !== undefined) {
      items.push({
        type: "message",
        role: "user",
        content: `Earlier conversation summary:\n${compact.summary}`,
      });
    }
    items.push(
      ...conversationItemsFromRuntimeEvents(
        this.filteredContextRows(sessionId, state, options ?? {})
          .map((row) => JSON.parse(row.payload))
          .filter(isRuntimeEvent),
      ),
    );
    return items;
  }

  private filteredContextRows(
    sessionId: string,
    state: ContextModeState,
    options: ModelContextReadOptions,
  ): ContextEventRow[] {
    const afterEventId = state.compactEventId ?? 0;
    const rows = this.contextRows(sessionId).filter(
      (row) => row.eventId > afterEventId,
    );
    if (!state.liteEnabled) {
      return rows;
    }
    if (options.pruneToolLogsForNewUserTurn === true) {
      return rows.filter((row) => !isToolContextRow(row));
    }
    let latestUserTurnEventId = 0;
    for (const row of rows) {
      const event = JSON.parse(row.payload);
      if (!isRuntimeEvent(event)) {
        continue;
      }
      if (event.msg.type === "turn_started") {
        latestUserTurnEventId = row.eventId;
      }
    }
    return rows.filter((row) => {
      if (!isToolContextRow(row)) {
        return true;
      }
      return latestUserTurnEventId === 0 || row.eventId > latestUserTurnEventId;
    });
  }

  private contextRows(sessionId: string): ContextEventRow[] {
    const table = this.readContextTableForSession(sessionId);
    if (table !== undefined) {
      const rows = this.db
        .prepare(
          `select event_id as eventId, item_seq as itemSeq, payload_json as payload from ${table} where session_id = ? order by item_seq asc`,
        )
        .all(sessionId) as ContextEventRow[];
      if (rows.length > 0) {
        return rows;
      }
    }
    return this.db
      .prepare(
        "select event_id as eventId, item_seq as itemSeq, payload_json as payload from session_context_items where session_id = ? order by item_seq asc",
      )
      .all(sessionId) as ContextEventRow[];
  }

  private contextModeState(sessionId: string): ContextModeState {
    const row = this.db
      .prepare(
        "select lite_enabled as liteEnabled, compact_event_id as compactEventId, updated_at as updatedAt from session_context_state where session_id = ?",
      )
      .get(sessionId) as
      | { liteEnabled?: unknown; compactEventId?: unknown; updatedAt?: unknown }
      | undefined;
    return {
      liteEnabled: row?.liteEnabled === 1,
      compactEventId:
        typeof row?.compactEventId === "number"
          ? row.compactEventId
          : undefined,
      updatedAt: typeof row?.updatedAt === "number" ? row.updatedAt : undefined,
    };
  }

  private compactRecord(
    sessionId: string,
    eventId: number | undefined,
  ): { summary: string } | undefined {
    if (eventId === undefined) {
      return undefined;
    }
    const row = this.db
      .prepare(
        "select payload_json as payload from session_events where session_id = ? and id = ? and type = 'context_compact'",
      )
      .get(sessionId, eventId) as { payload?: unknown } | undefined;
    if (typeof row?.payload !== "string") {
      return undefined;
    }
    const parsed = JSON.parse(row.payload) as { summary?: unknown };
    return typeof parsed.summary === "string"
      ? { summary: parsed.summary }
      : undefined;
  }

  private buildCompactSummary(
    sessionId: string,
    previousCompactEventId: number | undefined,
  ): string {
    const parts: string[] = [];
    const previous = this.compactRecord(sessionId, previousCompactEventId);
    if (previous !== undefined) {
      parts.push(previous.summary);
    }
    const rows = this.db
      .prepare(
        [
          "select id, payload_json as payload, msg_type as msgType, turn_id as turnId",
          "from session_events",
          "where session_id = ? and type = 'runtime_event' and id > ?",
          "order by id asc",
        ].join(" "),
      )
      .all(sessionId, previousCompactEventId ?? 0) as RuntimeEventRow[];
    const turnPrompts = new Map<string, string>();
    const turnAnswers = new Map<string, string>();
    for (const row of rows) {
      const event = runtimeEvent(
        JSON.parse(row.payload) as Record<string, unknown>,
      );
      if (event === undefined) {
        continue;
      }
      const turnId = eventTurnId(event);
      if (event.msg.type === "turn_started") {
        turnPrompts.set(event.msg.turnId, event.msg.prompt);
        continue;
      }
      if (
        event.msg.type === "agent_message" &&
        turnId !== undefined &&
        event.msg.text.length > 0
      ) {
        turnAnswers.set(turnId, event.msg.text);
        continue;
      }
      if (
        event.msg.type === "turn_complete" &&
        event.msg.finalText.length > 0
      ) {
        turnAnswers.set(event.msg.turnId, event.msg.finalText);
      }
    }
    for (const [turnId, prompt] of turnPrompts) {
      const answer = turnAnswers.get(turnId) ?? "";
      parts.push(
        [`User: ${prompt}`, answer.length > 0 ? `Assistant: ${answer}` : ""]
          .filter((line) => line.length > 0)
          .join("\n"),
      );
    }
    return parts.length === 0
      ? "No completed user and assistant turns before this compact point."
      : parts.join("\n\n");
  }

  private migrateProjectionSchema(): void {
    for (const statement of [
      [
        "projects",
        "next_sequence",
        "alter table projects add column next_sequence integer not null default 1",
      ],
      [
        "sessions",
        "event_count",
        "alter table sessions add column event_count integer not null default 0",
      ],
      [
        "sessions",
        "last_event_id",
        "alter table sessions add column last_event_id integer",
      ],
      [
        "sessions",
        "last_turn_id",
        "alter table sessions add column last_turn_id text",
      ],
      [
        "session_events",
        "msg_type",
        "alter table session_events add column msg_type text",
      ],
      [
        "session_events",
        "turn_id",
        "alter table session_events add column turn_id text",
      ],
    ] as const) {
      const [table, column, sql] = statement;
      if (!this.hasColumn(table, column)) {
        this.db.exec(sql);
      }
    }
  }

  private backfillProjectionRows(): void {
    this.db.exec(`
      update projects
      set next_sequence = (
        select coalesce(max(s.sequence), 0) + 1
        from sessions s
        where s.project_id = projects.id
      )
      where next_sequence <= 1;
      update sessions
      set event_count = (
        select count(1)
        from session_events e
        where e.session_id = sessions.id and e.type = 'runtime_event'
      )
      where event_count = 0;
      update sessions
      set last_event_id = (
        select max(e.id)
        from session_events e
        where e.session_id = sessions.id
      )
      where last_event_id is null;
    `);
    this.backfillEventMetadata();
    this.backfillContextItems();
    this.backfillContextPartitions();
  }

  private backfillEventMetadata(): void {
    const rows = this.db
      .prepare(
        "select id, payload_json as payload from session_events where type = 'runtime_event' and (msg_type is null or turn_id is null)",
      )
      .all() as Array<{ id: number; payload: string }>;
    for (const row of rows) {
      const parsed = JSON.parse(row.payload) as Record<string, unknown>;
      const event = runtimeEvent(parsed);
      this.db
        .prepare(
          "update session_events set msg_type = ?, turn_id = ? where id = ?",
        )
        .run(event?.msg.type ?? null, eventTurnId(event) ?? null, row.id);
    }
  }

  private backfillContextItems(): void {
    const rows = this.db
      .prepare(
        [
          "select e.id, e.session_id as sessionId, e.payload_json as payload",
          "from session_events e",
          "left join session_context_items c on c.event_id = e.id",
          "where e.type = 'runtime_event' and c.id is null",
          "order by e.session_id asc, e.id asc",
        ].join(" "),
      )
      .all() as Array<{ id: number; sessionId: string; payload: string }>;
    const nextBySession = new Map<string, number>();
    for (const row of rows) {
      const parsed = JSON.parse(row.payload) as Record<string, unknown>;
      const event = runtimeEvent(parsed);
      if (event === undefined || !isContextEvent(event)) {
        continue;
      }
      let next = nextBySession.get(row.sessionId);
      if (next === undefined) {
        const nextRow = this.db
          .prepare(
            "select coalesce(max(item_seq), 0) + 1 as next from session_context_items where session_id = ?",
          )
          .get(row.sessionId) as { next?: unknown } | undefined;
        next = typeof nextRow?.next === "number" ? nextRow.next : 1;
      }
      this.db
        .prepare(
          "insert or ignore into session_context_items (session_id, event_id, item_seq, payload_json, created_at) values (?, ?, ?, ?, ?)",
        )
        .run(row.sessionId, row.id, next, JSON.stringify(event), Date.now());
      const table = this.contextTableForSession(row.sessionId);
      this.db
        .prepare(
          `insert or ignore into ${table} (session_id, event_id, item_seq, payload_json, msg_type, turn_id, created_at) values (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.sessionId,
          row.id,
          next,
          JSON.stringify(event),
          event.msg.type,
          eventTurnId(event) ?? null,
          Date.now(),
        );
      nextBySession.set(row.sessionId, next + 1);
    }
  }

  private backfillContextPartitions(): void {
    const rows = this.db
      .prepare(
        [
          "select session_id as sessionId, event_id as eventId, item_seq as itemSeq,",
          "payload_json as payload, created_at as createdAt",
          "from session_context_items",
          "order by session_id asc, item_seq asc",
        ].join(" "),
      )
      .all() as Array<{
      sessionId: string;
      eventId: number;
      itemSeq: number;
      payload: string;
      createdAt: number;
    }>;
    for (const row of rows) {
      const event = JSON.parse(row.payload);
      if (!isRuntimeEvent(event)) {
        continue;
      }
      const table = this.contextTableForSession(row.sessionId);
      this.db
        .prepare(
          `insert or ignore into ${table} (session_id, event_id, item_seq, payload_json, msg_type, turn_id, created_at) values (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.sessionId,
          row.eventId,
          row.itemSeq,
          row.payload,
          event.msg.type,
          eventTurnId(event) ?? null,
          row.createdAt,
        );
    }
  }

  private initializeContextPartitions(): void {
    for (let index = 0; index < CONTEXT_PARTITION_COUNT; index += 1) {
      const table = contextPartitionTable(index);
      this.db.exec(`
        create table if not exists ${table} (
          id integer primary key autoincrement,
          session_id text not null references sessions(id) on delete cascade,
          event_id integer not null references session_events(id) on delete cascade,
          item_seq integer not null,
          payload_json text not null,
          msg_type text,
          turn_id text,
          created_at integer not null,
          unique(session_id, item_seq),
          unique(event_id)
        );
        create index if not exists idx_${table}_session_seq on ${table}(session_id, item_seq);
        create index if not exists idx_${table}_session_event on ${table}(session_id, event_id);
        create index if not exists idx_${table}_turn on ${table}(session_id, turn_id, item_seq);
      `);
    }
  }

  private contextTableForSession(sessionId: string): string {
    const existing = this.readContextTableForSession(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const row = this.db
      .prepare(
        [
          "select s.user_id as userId, s.project_id as projectId",
          "from sessions s where s.id = ?",
        ].join(" "),
      )
      .get(sessionId) as { userId?: unknown; projectId?: unknown } | undefined;
    const userId = typeof row?.userId === "string" ? row.userId : "";
    const projectId = typeof row?.projectId === "string" ? row.projectId : "";
    const segmentKey = `${userId}:${projectId}`;
    const table = contextPartitionTable(hashToPartition(segmentKey));
    this.db
      .prepare(
        [
          "insert or ignore into session_context_segments",
          "(session_id, user_id, project_id, segment_key, table_name, created_at)",
          "values (?, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(sessionId, userId, projectId, segmentKey, table, Date.now());
    return table;
  }

  private readContextTableForSession(sessionId: string): string | undefined {
    const row = this.db
      .prepare(
        "select table_name as tableName from session_context_segments where session_id = ?",
      )
      .get(sessionId) as { tableName?: unknown } | undefined;
    return typeof row?.tableName === "string" &&
      /^session_context_items_[0-9a-f]{2}$/.test(row.tableName)
      ? row.tableName
      : undefined;
  }

  private hasColumn(table: string, column: string): boolean {
    return this.db
      .prepare(`pragma table_info(${table})`)
      .all()
      .some((row) => (row as { name?: unknown }).name === column);
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("begin immediate");
    try {
      const value = fn();
      this.db.exec("commit");
      return value;
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }
}

function conversationItemsFromRuntimeEvents(
  events: RuntimeEvent[],
): ModelConversationItem[] {
  const history: ModelConversationItem[] = [];
  const pendingToolCalls = new Map<
    string,
    Array<{ callId: string; name: string; arguments: string }>
  >();
  const turnToolCounts = new Map<string, number>();

  for (const event of events) {
    const msg = event.msg;
    if (msg.type === "turn_started") {
      history.push({ type: "message", role: "user", content: msg.prompt });
      continue;
    }
    if (msg.type === "tool_call") {
      const count = (turnToolCounts.get(msg.turnId) ?? 0) + 1;
      turnToolCounts.set(msg.turnId, count);
      const call = {
        callId: `restored-${msg.turnId}-${count}`,
        name: msg.name,
        arguments: msg.arguments,
      };
      pendingToolCalls.set(msg.turnId, [
        ...(pendingToolCalls.get(msg.turnId) ?? []),
        call,
      ]);
      history.push({ type: "assistant_tool_calls", toolCalls: [call] });
      continue;
    }
    if (msg.type === "tool_result") {
      const pending = pendingToolCalls.get(msg.turnId) ?? [];
      const call = pending.shift();
      pendingToolCalls.set(msg.turnId, pending);
      if (call !== undefined) {
        history.push({
          type: "function_call_output",
          call_id: call.callId,
          output: msg.output,
        });
      }
      continue;
    }
    if (msg.type === "agent_message" && msg.text.length > 0) {
      history.push({ type: "message", role: "assistant", content: msg.text });
      continue;
    }
    if (msg.type === "turn_complete" && msg.finalText.length > 0) {
      const last = history.at(-1);
      if (
        last?.type !== "message" ||
        last.role !== "assistant" ||
        last.content !== msg.finalText
      ) {
        history.push({
          type: "message",
          role: "assistant",
          content: msg.finalText,
        });
      }
    }
  }

  return history;
}

function contextPartitionTable(index: number): string {
  return `session_context_items_${index.toString(16).padStart(2, "0")}`;
}

function hashToPartition(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % CONTEXT_PARTITION_COUNT;
}

function projectId(user: string, cwd: string): string {
  return `${user}:${cwd}`;
}

function addInFilter(
  where: string[],
  values: unknown[],
  column: string,
  selected: string[],
): void {
  const normalized = selected.filter((value) => value.length > 0);
  if (normalized.length === 0) {
    return;
  }
  where.push(`${column} in (${normalized.map(() => "?").join(", ")})`);
  values.push(...normalized);
}

function recordTimestamp(record: Record<string, unknown>): number {
  for (const key of [
    "recordedAt",
    "requestedAt",
    "disconnectedAt",
    "restoredAt",
    "createdAt",
  ]) {
    const value = record[key];
    if (typeof value === "number") {
      return value;
    }
  }
  return Date.now();
}

function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const event = value as { id?: unknown; msg?: unknown };
  return (
    typeof event.id === "string" &&
    event.msg !== null &&
    typeof event.msg === "object" &&
    typeof (event.msg as { type?: unknown }).type === "string"
  );
}

function runtimeEvent(
  record: Record<string, unknown>,
): RuntimeEvent | undefined {
  const event = record.event;
  return isRuntimeEvent(event) ? event : undefined;
}

function isContextEvent(event: RuntimeEvent): boolean {
  return (
    event.msg.type === "turn_started" ||
    event.msg.type === "agent_message" ||
    event.msg.type === "tool_call" ||
    event.msg.type === "tool_result" ||
    event.msg.type === "turn_complete"
  );
}

function isToolContextRow(row: ContextEventRow): boolean {
  const event = JSON.parse(row.payload);
  return (
    isRuntimeEvent(event) &&
    (event.msg.type === "tool_call" || event.msg.type === "tool_result")
  );
}

function eventTurnId(event: RuntimeEvent | undefined): string | undefined {
  if (event === undefined) {
    return undefined;
  }
  const value = (event.msg as { turnId?: unknown }).turnId;
  return typeof value === "string" ? value : undefined;
}

function statusFromEvent(
  event: RuntimeEvent,
  fallback: StoredSessionStatus | undefined,
): StoredSessionStatus {
  if (event.msg.type === "turn_complete") {
    return "idle";
  }
  if (event.msg.type === "turn_aborted") {
    return "aborted";
  }
  if (event.msg.type === "error") {
    return "failed";
  }
  return fallback ?? "running";
}
