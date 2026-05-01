import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
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

  createSession(input: {
    id: string;
    user: string;
    cwd: string;
    title: string;
    status: StoredSessionStatus;
    model: string;
    createdAt: number;
  }): number {
    this.transaction(() => {
      this.ensureProject(input.user, input.cwd, input.createdAt);
      const sequence = this.nextSequence(input.user, input.cwd);
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
          projectId(input.user, input.cwd),
          sequence,
          input.title,
          input.status,
          input.model,
          input.createdAt,
          input.createdAt,
        );
      this.insertEvent(input.id, "session_started", {
        type: "session_started",
        sessionId: input.id,
        user: input.user,
        cwd: input.cwd,
        sequence,
        title: input.title,
        createdAt: input.createdAt,
      });
    });
    return this.nextSequence(input.user, input.cwd) - 1;
  }

  appendRecord(
    sessionId: string,
    type: string,
    record: Record<string, unknown>,
  ) {
    this.insertEvent(sessionId, type, record);
    this.applySessionMutation(sessionId, type, record);
  }

  listSessions(user: string, cwd: string): StoredSessionListEntry[] {
    const rows = this.db
      .prepare(
        [
          "select s.id, s.user_id as user, p.cwd, s.status, s.created_at as createdAt,",
          "s.updated_at as updatedAt, s.sequence, s.title,",
          "(select count(1) from session_events e where e.session_id = s.id and e.type = 'runtime_event') as eventCount",
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
    return this.readSession(sessionId) !== undefined;
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
        unique(user_id, cwd)
      );
      create table if not exists clients (
        id text primary key,
        user_id text not null references users(id) on delete cascade,
        kind text,
        last_seen_at integer not null
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
        unique(user_id, project_id, sequence)
      );
      create table if not exists session_events (
        id integer primary key autoincrement,
        session_id text not null references sessions(id) on delete cascade,
        type text not null,
        payload_json text not null,
        created_at integer not null
      );
      create table if not exists session_owners (
        session_id text primary key references sessions(id) on delete cascade,
        server_id text not null,
        claimed_at integer not null
      );
    `);
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
        "insert or ignore into projects (id, user_id, cwd, created_at) values (?, ?, ?, ?)",
      )
      .run(projectId(user, cwd), user, cwd, now);
  }

  private nextSequence(user: string, cwd: string): number {
    const row = this.db
      .prepare(
        [
          "select coalesce(max(s.sequence), 0) + 1 as next",
          "from sessions s join projects p on p.id = s.project_id",
          "where s.user_id = ? and p.cwd = ?",
        ].join(" "),
      )
      .get(user, cwd) as { next?: unknown } | undefined;
    return typeof row?.next === "number" ? row.next : 1;
  }

  private insertEvent(
    sessionId: string,
    type: string,
    payload: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        "insert into session_events (session_id, type, payload_json, created_at) values (?, ?, ?, ?)",
      )
      .run(sessionId, type, JSON.stringify(payload), Date.now());
  }

  private applySessionMutation(
    sessionId: string,
    type: string,
    record: Record<string, unknown>,
  ): void {
    const updatedAt = recordTimestamp(record);
    if (type === "runtime_event") {
      const event = record.event;
      if (isRuntimeEvent(event)) {
        this.db
          .prepare(
            "update sessions set status = ?, updated_at = ? where id = ?",
          )
          .run(statusFromEvent(event, undefined), updatedAt, sessionId);
      }
      return;
    }
    if (type === "session_detached") {
      const status =
        typeof record.status === "string" ? record.status : undefined;
      if (status !== undefined) {
        this.db
          .prepare(
            "update sessions set status = ?, updated_at = ? where id = ?",
          )
          .run(status, updatedAt, sessionId);
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

function projectId(user: string, cwd: string): string {
  return `${user}:${cwd}`;
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
  const event = value as { msg?: unknown };
  return (
    event.msg !== null &&
    typeof event.msg === "object" &&
    typeof (event.msg as { type?: unknown }).type === "string"
  );
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
