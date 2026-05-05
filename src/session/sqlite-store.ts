import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
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
  projectId: string;
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
  projectId: string;
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

export interface DashboardOverview {
  accountCount: number;
  activeAccountCount: number;
  blockedAccountCount: number;
  protectedAccountCount: number;
  projectCount: number;
  sessionCount: number;
  deletedSessionCount: number;
  eventCount: number;
  latestLogin?: number;
  latestSessionUpdate?: number;
}

export interface DashboardUserSummary extends AccountRecord {
  sessionCount: number;
  projectCount: number;
  eventCount: number;
  lastSessionCreatedAt?: number;
  lastSessionUpdatedAt?: number;
}

export interface AccountRecord {
  userid: string;
  created: number;
  lastlogin: number;
  isblock: boolean;
  isprotected: boolean;
}

export const DEFAULT_USER_ID = "defaultuser";
const SESSION_SCHEMA_VERSION = 3;

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

  projectIdForCwd(cwd: string): string {
    return this.projectIdForPath(cwd);
  }

  createAccount(username: string): AccountRecord {
    const userid = normalizeAccountId(username);
    const now = Date.now();
    const isprotected = userid === DEFAULT_USER_ID;
    this.db
      .prepare(
        [
          "insert into users",
          "(id, username, password, created_at, updated_at, userid, created, lastlogin, isblock, isprotected)",
          "values (?, ?, '', ?, ?, ?, ?, ?, 0, ?)",
        ].join(" "),
      )
      .run(userid, userid, now, now, userid, now, now, isprotected ? 1 : 0);
    return {
      userid,
      created: now,
      lastlogin: now,
      isblock: false,
      isprotected,
    };
  }

  accountExists(username: string): boolean {
    const userid = normalizeAccountId(username);
    return (
      this.db.prepare("select 1 from users where userid = ?").get(userid) !==
      undefined
    );
  }

  account(username: string): AccountRecord | undefined {
    const userid = normalizeAccountId(username);
    const row = this.db
      .prepare(
        "select userid, created, lastlogin, isblock, isprotected from users where userid = ?",
      )
      .get(userid) as
      | {
          userid?: unknown;
          created?: unknown;
          lastlogin?: unknown;
          isblock?: unknown;
          isprotected?: unknown;
        }
      | undefined;
    if (
      typeof row?.userid !== "string" ||
      typeof row.created !== "number" ||
      typeof row.lastlogin !== "number"
    ) {
      return undefined;
    }
    return {
      userid: row.userid,
      created: row.created,
      lastlogin: row.lastlogin,
      isblock: row.isblock === 1,
      isprotected: row.isprotected === 1,
    };
  }

  loginAccount(username: string): AccountRecord {
    const userid = normalizeAccountId(username);
    const account = this.account(userid);
    if (account === undefined) {
      throw new Error("invalid account");
    }
    if (account.isblock) {
      throw new Error(`account is blocked: ${userid}`);
    }
    const now = Date.now();
    this.db
      .prepare(
        "update users set lastlogin = ?, updated_at = ? where userid = ?",
      )
      .run(now, now, userid);
    return { ...account, lastlogin: now };
  }

  previousLoginAccount(): AccountRecord | undefined {
    const row = this.db
      .prepare(
        [
          "select userid, created, lastlogin, isblock, isprotected",
          "from users",
          "where isblock = 0",
          "order by lastlogin desc, rowid desc",
          "limit 1",
        ].join(" "),
      )
      .get() as
      | {
          userid?: unknown;
          created?: unknown;
          lastlogin?: unknown;
          isblock?: unknown;
          isprotected?: unknown;
        }
      | undefined;
    if (
      typeof row?.userid !== "string" ||
      typeof row.created !== "number" ||
      typeof row.lastlogin !== "number"
    ) {
      return undefined;
    }
    return {
      userid: row.userid,
      created: row.created,
      lastlogin: row.lastlogin,
      isblock: row.isblock === 1,
      isprotected: row.isprotected === 1,
    };
  }

  blockAccount(username: string): AccountRecord {
    const userid = normalizeAccountId(username);
    const account = this.account(userid);
    if (account === undefined) {
      throw new Error(`unknown account: ${userid}`);
    }
    if (account.isprotected) {
      throw new Error(`${userid} cannot be blocked`);
    }
    this.db
      .prepare("update users set isblock = 1 where userid = ?")
      .run(userid);
    return { ...account, isblock: true };
  }

  unblockAccount(username: string): AccountRecord {
    const userid = normalizeAccountId(username);
    const account = this.account(userid);
    if (account === undefined) {
      throw new Error(`unknown account: ${userid}`);
    }
    if (account.isprotected) {
      throw new Error(`${userid} cannot be unblocked`);
    }
    this.db
      .prepare("update users set isblock = 0 where userid = ?")
      .run(userid);
    return { ...account, isblock: false };
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
      const userid = normalizeAccountId(input.user);
      if (!this.accountExists(userid)) {
        this.createAccount(userid);
      }
      const project = this.projectIdForPath(input.cwd);
      const sequence = this.claimNextSequence(userid, project);
      this.db
        .prepare(
          [
            "insert into session",
            "(sessionid, created, userid, projectid, path, islite, ownerid, lastlogin, status, model, sequence, title, updated)",
            "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ].join(" "),
        )
        .run(
          input.id,
          input.createdAt,
          userid,
          project,
          resolve(input.cwd),
          0,
          null,
          input.createdAt,
          input.status,
          input.model,
          sequence,
          input.title,
          input.createdAt,
        );
      this.insertEvent(input.id, "session_started", undefined, {
        type: "session_started",
        sessionId: input.id,
        user: userid,
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
      this.applySessionMutation(sessionId, type, eventId, record);
    });
  }

  listSessions(user: string, cwd: string): StoredSessionListEntry[] {
    const rows = this.db
      .prepare(
        [
          "select sessionid as id, userid as user, projectid as projectId, path as cwd, status, created as createdAt,",
          "updated as updatedAt, sequence, title, eventcount as eventCount",
          "from session",
          "where userid = ? and projectid = ? and deleted is null",
          "order by sequence asc",
        ].join(" "),
      )
      .all(user, this.projectIdForPath(cwd)) as StoredSessionListEntry[];
    return rows;
  }

  readSession(sessionId: string): StoredSession | undefined {
    const row = this.db
      .prepare(
        [
          "select sessionid as id, userid as user, projectid as projectId, path as cwd, status, created as createdAt,",
          "updated as updatedAt, sequence, title",
          "from session",
          "where sessionid = ? and deleted is null",
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
          "select sessionid as id, userid as user, projectid as projectId, path as cwd, status, created as createdAt,",
          "updated as updatedAt, sequence, title",
          "from session",
          "where deleted is null",
          "order by created asc",
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
          "select distinct userid as user",
          "from session",
          "where deleted is null",
          "order by userid asc",
        ].join(" "),
      )
      .all()
      .map((row) => (row as { user: string }).user);
    const projects = this.db
      .prepare(
        [
          "select distinct projectid as id",
          "from session",
          "where deleted is null",
          "order by path asc",
        ].join(" "),
      )
      .all()
      .map((row) => (row as { id: string }).id);
    const sessions = this.db
      .prepare(
        [
          "select sessionid as id, userid as user, path as cwd, sequence, title",
          "from session",
          "where deleted is null",
          "order by rowid asc",
        ].join(" "),
      )
      .all() as DashboardSessionLogFacets["sessions"];
    return { accounts, projects, sessions };
  }

  dashboardOverview(): DashboardOverview {
    const accountRow = this.db
      .prepare(
        [
          "select count(1) as accountCount,",
          "sum(case when isblock = 0 then 1 else 0 end) as activeAccountCount,",
          "sum(case when isblock = 1 then 1 else 0 end) as blockedAccountCount,",
          "sum(case when isprotected = 1 then 1 else 0 end) as protectedAccountCount,",
          "max(lastlogin) as latestLogin",
          "from users",
        ].join(" "),
      )
      .get() as
      | {
          accountCount?: unknown;
          activeAccountCount?: unknown;
          blockedAccountCount?: unknown;
          protectedAccountCount?: unknown;
          latestLogin?: unknown;
        }
      | undefined;
    const sessionRow = this.db
      .prepare(
        [
          "select count(case when deleted is null then 1 end) as sessionCount,",
          "count(case when deleted is not null then 1 end) as deletedSessionCount,",
          "coalesce(sum(case when deleted is null then eventcount else 0 end), 0) as eventCount,",
          "max(case when deleted is null then updated end) as latestSessionUpdate",
          "from session",
        ].join(" "),
      )
      .get() as
      | {
          sessionCount?: unknown;
          deletedSessionCount?: unknown;
          eventCount?: unknown;
          latestSessionUpdate?: unknown;
        }
      | undefined;
    const projectRow = this.db
      .prepare(
        "select count(distinct projectid) as projectCount from session where deleted is null",
      )
      .get() as { projectCount?: unknown } | undefined;
    return {
      accountCount: numericRowValue(accountRow?.accountCount),
      activeAccountCount: numericRowValue(accountRow?.activeAccountCount),
      blockedAccountCount: numericRowValue(accountRow?.blockedAccountCount),
      protectedAccountCount: numericRowValue(accountRow?.protectedAccountCount),
      projectCount: numericRowValue(projectRow?.projectCount),
      sessionCount: numericRowValue(sessionRow?.sessionCount),
      deletedSessionCount: numericRowValue(sessionRow?.deletedSessionCount),
      eventCount: numericRowValue(sessionRow?.eventCount),
      latestLogin: optionalNumericRowValue(accountRow?.latestLogin),
      latestSessionUpdate: optionalNumericRowValue(
        sessionRow?.latestSessionUpdate,
      ),
    };
  }

  dashboardUsers(): DashboardUserSummary[] {
    return this.db
      .prepare(
        [
          "select u.userid, u.created, u.lastlogin, u.isblock, u.isprotected,",
          "count(s.rowid) as sessionCount,",
          "count(distinct s.projectid) as projectCount,",
          "coalesce(sum(s.eventcount), 0) as eventCount,",
          "max(s.created) as lastSessionCreatedAt,",
          "max(s.updated) as lastSessionUpdatedAt",
          "from users u",
          "left join session s on s.userid = u.userid and s.deleted is null",
          "group by u.userid, u.created, u.lastlogin, u.isblock, u.isprotected",
          "order by u.lastlogin desc, u.userid asc",
        ].join(" "),
      )
      .all()
      .map((row) => dashboardUserSummary(row));
  }

  listDashboardSessionLogs(
    filters: DashboardSessionLogFilters,
  ): DashboardSessionLogEntry[] {
    const where = ["deleted is null"];
    const values: unknown[] = [];
    addInFilter(where, values, "userid", filters.accounts);
    addInFilter(where, values, "projectid", filters.projects);
    addInFilter(where, values, "sessionid", filters.sessions);
    return this.db
      .prepare(
        [
          "select sessionid as id, userid as user, projectid as projectId, path as cwd, status, created as createdAt,",
          "updated as updatedAt, sequence, title, eventcount as eventCount,",
          "lastdatarowid as lastEventId, lastturnid as lastTurnId",
          "from session",
          `where ${where.join(" and ")}`,
          "order by rowid asc",
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
        [
          "select count(1) as total",
          "from sessiondata d join session s on s.rowid = d.sessionrowid",
          "where s.sessionid = ?",
        ].join(" "),
      )
      .get(sessionId) as { total?: unknown } | undefined;
    const total = typeof totalRow?.total === "number" ? totalRow.total : 0;
    const rows = this.db
      .prepare(
        [
          "select d.rowid as id, s.sessionid as sessionId, d.type, d.msgtype as msgType,",
          "d.turnid as turnId, d.payload_json as payloadJson, d.created as createdAt",
          "from sessiondata d join session s on s.rowid = d.sessionrowid",
          "where s.sessionid = ?",
          "order by d.rowid asc",
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
          "select sessionid as id, userid as user, projectid as projectId, path as cwd, status, created as createdAt,",
          "updated as updatedAt, sequence, title, eventcount as eventCount,",
          "lastdatarowid as lastEventId, lastturnid as lastTurnId",
          "from session",
          "where sessionid = ? and deleted is null",
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
      .prepare("update session set islite = ? where sessionid = ?")
      .run(enabled ? 1 : 0, sessionId);
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
          "update session set compactrowid = ?, updated = ? where sessionid = ?",
        )
        .run(eventId, compactedAt, sessionId);
      return { summary, eventId, compactedAt };
    });
  }

  deleteSession(sessionId: string): void {
    this.db
      .prepare(
        "update session set deleted = ?, updated = ?, ownerid = null where sessionid = ?",
      )
      .run(Date.now(), Date.now(), sessionId);
  }

  sessionExists(sessionId: string): boolean {
    return (
      this.db
        .prepare(
          "select 1 from session where sessionid = ? and deleted is null",
        )
        .get(sessionId) !== undefined
    );
  }

  claimOwner(sessionId: string, ownerId: string): void {
    const now = Date.now();
    this.db
      .prepare(
        "update session set ownerid = ?, lastlogin = ? where sessionid = ?",
      )
      .run(ownerId, now, sessionId);
  }

  currentOwner(sessionId: string): string | undefined {
    const row = this.db
      .prepare(
        "select ownerid from session where sessionid = ? and deleted is null",
      )
      .get(sessionId) as { ownerid?: unknown } | undefined;
    return typeof row?.ownerid === "string" ? row.ownerid : undefined;
  }

  private initialize(): void {
    this.db.exec("pragma journal_mode = wal");
    this.db.exec("pragma foreign_keys = on");
    this.db.exec("pragma busy_timeout = 5000");
    this.db.exec("pragma synchronous = normal");
    this.db.exec(`
      drop table if exists session_context_items_00;
      drop table if exists session_context_items_01;
      drop table if exists session_context_items_02;
      drop table if exists session_context_items_03;
      drop table if exists session_context_items_04;
      drop table if exists session_context_items_05;
      drop table if exists session_context_items_06;
      drop table if exists session_context_items_07;
      drop table if exists session_context_items_08;
      drop table if exists session_context_items_09;
      drop table if exists session_context_items_0a;
      drop table if exists session_context_items_0b;
      drop table if exists session_context_items_0c;
      drop table if exists session_context_items_0d;
      drop table if exists session_context_items_0e;
      drop table if exists session_context_items_0f;
      drop table if exists session_context_segments;
      drop table if exists session_context_state;
      drop table if exists session_context_items;
      drop table if exists session_owners;
      drop table if exists session_events;
      drop table if exists sessions;
      drop table if exists projects;
      create table if not exists users (
        id text primary key,
        username text not null unique,
        password text not null,
        created_at integer not null,
        updated_at integer not null,
        userid text not null unique,
        created integer not null,
        lastlogin integer not null,
        isblock integer not null default 0,
        isprotected integer not null default 0
      );
      create table if not exists clients (
        id text primary key,
        user_id text not null references users(id) on delete cascade,
        kind text,
        last_seen_at integer not null
      );
    `);
    this.migrateUserAccountSchema();
    this.db.exec(`
      create unique index if not exists idx_users_userid on users(userid);
      create index if not exists idx_users_lastlogin on users(lastlogin);
    `);
    this.migrateSessionSchemaIfNeeded();
    this.ensureSessionTables();
    this.db.exec(`
      create index if not exists idx_session_user_project on session(userid, projectid);
      create index if not exists idx_session_sessionid on session(sessionid);
      create index if not exists idx_session_project_sequence_live on session(projectid, sequence) where deleted is null;
      create index if not exists idx_sessiondata_sessionrowid on sessiondata(sessionrowid, rowid);
      create index if not exists idx_sessiondata_type on sessiondata(sessionrowid, type, rowid);
      create index if not exists idx_sessiondata_turn on sessiondata(sessionrowid, turnid, rowid);
    `);
    if (!this.accountExists(DEFAULT_USER_ID)) {
      this.createAccount(DEFAULT_USER_ID);
    }
  }

  private ensureSessionTables(): void {
    this.db.exec(`
      create table if not exists session (
        rowid integer primary key autoincrement,
        sessionid text not null unique,
        created integer not null,
        userid text not null references users(userid) on delete cascade,
        projectid text not null,
        path text not null,
        islite integer not null default 0,
        ownerid text,
        lastlogin integer not null,
        status text not null default 'idle',
        model text,
        sequence integer not null,
        title text not null,
        updated integer not null,
        deleted integer,
        eventcount integer not null default 0,
        lastdatarowid integer,
        lastturnid text,
        compactrowid integer,
        unique(userid, projectid, sequence)
      );
      create table if not exists sessiondata (
        rowid integer primary key autoincrement,
        type text not null,
        sessionrowid integer not null references session(rowid) on delete cascade,
        ownerid text,
        created integer not null,
        payload_json text not null,
        msgtype text,
        turnid text,
        iscontext integer not null default 0
      );
    `);
  }

  private migrateSessionSchemaIfNeeded(): void {
    const row = this.db.prepare("pragma user_version").get() as
      | { user_version?: unknown }
      | undefined;
    if (row?.user_version === SESSION_SCHEMA_VERSION) {
      return;
    }
    if (
      row?.user_version === 2 &&
      this.hasTable("session") &&
      this.hasTable("sessiondata")
    ) {
      this.migrateSessionUserForeignKey();
      this.db.exec(`pragma user_version = ${SESSION_SCHEMA_VERSION}`);
      return;
    }
    this.db.exec(`
      drop table if exists sessiondata;
      drop table if exists session;
      pragma user_version = ${SESSION_SCHEMA_VERSION};
    `);
  }

  private migrateSessionUserForeignKey(): void {
    this.db.exec(`
      alter table session rename to session_v2;
      alter table sessiondata rename to sessiondata_v2;
    `);
    this.ensureSessionTables();
    this.db.exec(`
      insert into session (
        rowid,
        sessionid,
        created,
        userid,
        projectid,
        path,
        islite,
        ownerid,
        lastlogin,
        status,
        model,
        sequence,
        title,
        updated,
        deleted,
        eventcount,
        lastdatarowid,
        lastturnid,
        compactrowid
      )
      select
        s.rowid,
        s.sessionid,
        s.created,
        coalesce(
          (select u.userid from users u where u.id = s.userid limit 1),
          lower(s.userid)
        ),
        s.projectid,
        s.path,
        s.islite,
        s.ownerid,
        s.lastlogin,
        s.status,
        s.model,
        s.sequence,
        s.title,
        s.updated,
        s.deleted,
        s.eventcount,
        s.lastdatarowid,
        s.lastturnid,
        s.compactrowid
      from session_v2 s
      where exists (
        select 1
        from users u
        where u.id = s.userid or u.userid = lower(s.userid)
      );

      insert into sessiondata (
        rowid,
        type,
        sessionrowid,
        ownerid,
        created,
        payload_json,
        msgtype,
        turnid,
        iscontext
      )
      select
        d.rowid,
        d.type,
        d.sessionrowid,
        d.ownerid,
        d.created,
        d.payload_json,
        d.msgtype,
        d.turnid,
        d.iscontext
      from sessiondata_v2 d
      where exists (
        select 1 from session s where s.rowid = d.sessionrowid
      );

      drop table sessiondata_v2;
      drop table session_v2;
    `);
  }

  private claimNextSequence(user: string, project: string): number {
    const row = this.db
      .prepare(
        "select coalesce(max(sequence), 0) + 1 as sequence from session where userid = ? and projectid = ?",
      )
      .get(user, project) as { sequence?: unknown } | undefined;
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
    const row = this.db
      .prepare("select rowid, ownerid from session where sessionid = ?")
      .get(sessionId) as { rowid?: unknown; ownerid?: unknown } | undefined;
    if (typeof row?.rowid !== "number") {
      throw new Error(`unknown session: ${sessionId}`);
    }
    const result = this.db
      .prepare(
        "insert into sessiondata (type, sessionrowid, ownerid, created, payload_json, msgtype, turnid, iscontext) values (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        type,
        row.rowid,
        typeof row.ownerid === "string" ? row.ownerid : null,
        Date.now(),
        JSON.stringify(payload),
        msg?.type ?? null,
        eventTurnId(event) ?? null,
        event !== undefined && isContextEvent(event) ? 1 : 0,
      );
    return result.lastInsertRowid;
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
              "update session set status = ?, updated = ?,",
              "eventcount = eventcount + 1, lastdatarowid = ?, lastturnid = ?",
              "where sessionid = ?",
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
            "update session set status = ?, updated = ?, lastdatarowid = ? where sessionid = ?",
          )
          .run(status, updatedAt, eventId, sessionId);
      }
    }
  }

  private runtimeEvents(sessionId: string): RuntimeEvent[] {
    return this.db
      .prepare(
        [
          "select d.payload_json as payload",
          "from sessiondata d join session s on s.rowid = d.sessionrowid",
          "where s.sessionid = ? and d.type = 'runtime_event'",
          "order by d.rowid asc",
        ].join(" "),
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
    const rows = this.db
      .prepare(
        [
          "select d.rowid as eventId, d.rowid as itemSeq, d.payload_json as payload",
          "from sessiondata d join session s on s.rowid = d.sessionrowid",
          "where s.sessionid = ? and d.iscontext = 1",
          "order by d.rowid asc",
        ].join(" "),
      )
      .all(sessionId) as ContextEventRow[];
    return rows
      .map((row) => {
        const event = runtimeEvent(
          JSON.parse(row.payload) as Record<string, unknown>,
        );
        return event === undefined
          ? undefined
          : { ...row, payload: JSON.stringify(event) };
      })
      .filter((row): row is ContextEventRow => row !== undefined);
  }

  private contextModeState(sessionId: string): ContextModeState {
    const row = this.db
      .prepare(
        "select islite as liteEnabled, compactrowid as compactEventId, updated as updatedAt from session where sessionid = ?",
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
        [
          "select d.payload_json as payload",
          "from sessiondata d join session s on s.rowid = d.sessionrowid",
          "where s.sessionid = ? and d.rowid = ? and d.type = 'context_compact'",
        ].join(" "),
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
          "select d.rowid as id, d.payload_json as payload, d.msgtype as msgType, d.turnid as turnId",
          "from sessiondata d join session s on s.rowid = d.sessionrowid",
          "where s.sessionid = ? and d.type = 'runtime_event' and d.rowid > ?",
          "order by d.rowid asc",
        ].join(" "),
      )
      .all(sessionId, previousCompactEventId ?? 0) as Array<{
      id: number;
      payload: string;
      msgType?: string;
      turnId?: string;
    }>;
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

  private projectIdForPath(cwd: string): string {
    const projectDir = resolve(cwd);
    const ndxDir = join(projectDir, ".ndx");
    const projectFile = join(ndxDir, ".project");
    if (existsSync(projectFile)) {
      const parsed = JSON.parse(readFileSync(projectFile, "utf8")) as {
        projectid?: unknown;
      };
      if (typeof parsed.projectid === "string" && parsed.projectid.length > 0) {
        return parsed.projectid;
      }
      throw new Error(`invalid ndx project identity: ${projectFile}`);
    }
    mkdirSync(ndxDir, { recursive: true });
    const projectid = randomUUID();
    writeFileSync(projectFile, `${JSON.stringify({ projectid })}\n`, "utf8");
    return projectid;
  }

  private migrateUserAccountSchema(): void {
    for (const statement of [
      ["users", "userid", "alter table users add column userid text"],
      ["users", "created", "alter table users add column created integer"],
      ["users", "lastlogin", "alter table users add column lastlogin integer"],
      [
        "users",
        "isblock",
        "alter table users add column isblock integer not null default 0",
      ],
      [
        "users",
        "isprotected",
        "alter table users add column isprotected integer not null default 0",
      ],
    ] as const) {
      const [table, column, sql] = statement;
      if (!this.hasColumn(table, column)) {
        this.db.exec(sql);
      }
    }
    this.db.exec(`
      update users
      set
        userid = lower(coalesce(userid, username, id)),
        created = coalesce(created, created_at),
        lastlogin = coalesce(lastlogin, updated_at),
        isprotected = case
          when username = 'defaultUser' or id = 'defaultUser' or lower(coalesce(userid, username, id)) = '${DEFAULT_USER_ID}' then 1
          else isprotected
        end
      where userid is null or created is null or lastlogin is null;
    `);
  }

  private hasColumn(table: string, column: string): boolean {
    return this.db
      .prepare(`pragma table_info(${table})`)
      .all()
      .some((row) => (row as { name?: unknown }).name === column);
  }

  private hasTable(table: string): boolean {
    return (
      this.db
        .prepare(
          "select 1 from sqlite_master where type = 'table' and name = ?",
        )
        .get(table) !== undefined
    );
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

export function normalizeAccountId(input: string): string {
  const userid = input.trim().toLowerCase();
  if (!/^[a-z0-9]+$/.test(userid)) {
    throw new Error("account id must contain only letters and numbers");
  }
  return userid;
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

function numericRowValue(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function optionalNumericRowValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function dashboardUserSummary(row: unknown): DashboardUserSummary {
  const value = row as {
    userid?: unknown;
    created?: unknown;
    lastlogin?: unknown;
    isblock?: unknown;
    isprotected?: unknown;
    sessionCount?: unknown;
    projectCount?: unknown;
    eventCount?: unknown;
    lastSessionCreatedAt?: unknown;
    lastSessionUpdatedAt?: unknown;
  };
  return {
    userid: typeof value.userid === "string" ? value.userid : "",
    created: numericRowValue(value.created),
    lastlogin: numericRowValue(value.lastlogin),
    isblock: value.isblock === 1,
    isprotected: value.isprotected === 1,
    sessionCount: numericRowValue(value.sessionCount),
    projectCount: numericRowValue(value.projectCount),
    eventCount: numericRowValue(value.eventCount),
    lastSessionCreatedAt: optionalNumericRowValue(value.lastSessionCreatedAt),
    lastSessionUpdatedAt: optionalNumericRowValue(value.lastSessionUpdatedAt),
  };
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
  if (
    (event.msg.type === "tool_call" || event.msg.type === "tool_result") &&
    isSkillToolName(event.msg.name)
  ) {
    return false;
  }
  return (
    event.msg.type === "turn_started" ||
    event.msg.type === "agent_message" ||
    event.msg.type === "tool_call" ||
    event.msg.type === "tool_result" ||
    event.msg.type === "turn_complete"
  );
}

function isSkillToolName(name: string | undefined): boolean {
  return (
    name !== undefined &&
    [
      "load_skill",
      "read_skill",
      "list_skills",
      "skill_load",
      "skill_search",
      "skills",
    ].includes(name)
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
