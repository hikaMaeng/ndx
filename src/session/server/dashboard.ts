import { resolve } from "node:path";
import type { NdxBootstrapReport, NdxConfig } from "../../shared/types.js";
import type { SessionServerAddress } from "../server.js";

export interface DashboardRenderInput {
  address: SessionServerAddress | undefined;
  bootstrap: NdxBootstrapReport;
  config: NdxConfig;
  cwd: string;
  packageVersion: string;
  sources: string[];
}

const DASHBOARD_ASCII_ART = [
  String.raw` _   _ ____  __  __`,
  String.raw`| \ | |  _ \ \ \/ /`,
  String.raw`|  \| | | | | \  /`,
  String.raw`| |\  | |_| | /  \ `,
  String.raw`|_| \_|____/ /_/\_\ `,
].join("\n");

export function renderDashboardHtml(input: DashboardRenderInput): string {
  const socketUrl = input.address?.url ?? "not listening";
  const dashboardUrl = input.address?.dashboardUrl ?? "not listening";
  const sources =
    input.sources.length === 0
      ? "<li>None</li>"
      : input.sources
          .map((source) => `<li><code>${escapeHtml(source)}</code></li>`)
          .join("");
  const bootstrapRows = input.bootstrap.elements
    .map(
      (element) =>
        `<li><span>${escapeHtml(element.status)}</span><code>${escapeHtml(element.name)}</code><small>${escapeHtml(element.path)}</small></li>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>NDX Dashboard</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f7f8f5;
        color: #1f2428;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background: #f7f8f5;
        color: #1f2428;
      }
      .shell {
        min-height: 100vh;
        display: grid;
        grid-template-columns: 248px minmax(0, 1fr);
      }
      aside {
        border-right: 1px solid #d7ddd2;
        background: #ffffff;
        padding: 24px 18px;
      }
      .brand { margin-bottom: 28px; }
      .brand strong {
        display: block;
        font-size: 30px;
        line-height: 1;
      }
      .brand small {
        display: block;
        margin-top: 6px;
        color: #647067;
        font-size: 13px;
      }
      nav {
        display: grid;
        gap: 10px;
      }
      button {
        width: 100%;
        min-height: 42px;
        border: 1px solid #cbd4c6;
        border-radius: 6px;
        background: #eef3ed;
        color: #1f2428;
        font: inherit;
        font-weight: 650;
        text-align: left;
        padding: 10px 12px;
        cursor: pointer;
      }
      button:hover { background: #e2ebdf; }
      button.secondary { background: #ffffff; }
      button.danger {
        border-color: #e1b7ad;
        background: #fff0ec;
      }
      button.danger:hover { background: #ffe3dc; }
      main { padding: 28px; }
      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
        gap: 24px;
        align-items: start;
      }
      h1 {
        margin: 0 0 14px;
        font-size: 28px;
        line-height: 1.15;
      }
      h2 {
        margin: 0 0 12px;
        font-size: 16px;
      }
      pre {
        margin: 0;
        overflow: auto;
        border: 1px solid #d7ddd2;
        border-radius: 6px;
        background: #151a1e;
        color: #d9f3df;
        padding: 18px;
        font: 14px/1.35 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      }
      section { margin-bottom: 22px; }
      dl {
        display: grid;
        grid-template-columns: 128px minmax(0, 1fr);
        gap: 8px 14px;
        margin: 0;
      }
      dt {
        color: #647067;
        font-weight: 650;
      }
      dd {
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      }
      ul {
        margin: 0;
        padding-left: 18px;
      }
      .session-log-panel {
        border-top: 1px solid #d7ddd2;
        padding-top: 22px;
      }
      .session-log-filters {
        display: grid;
        grid-template-columns: repeat(3, minmax(160px, 1fr));
        gap: 12px;
        align-items: end;
        margin-bottom: 12px;
      }
      label {
        display: grid;
        gap: 6px;
        color: #4d5a51;
        font-size: 13px;
        font-weight: 700;
      }
      select {
        width: 100%;
        min-height: 38px;
        border: 1px solid #cbd4c6;
        border-radius: 6px;
        background: #ffffff;
        color: #1f2428;
        font: inherit;
        padding: 7px 9px;
      }
      .filter-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        min-height: 34px;
        margin-bottom: 14px;
      }
      .filter-tag {
        width: auto;
        min-height: 30px;
        border-color: #abc4b1;
        background: #edf6ef;
        padding: 5px 9px;
        font-size: 13px;
      }
      .table-wrap {
        overflow-x: auto;
        border: 1px solid #d7ddd2;
        border-radius: 6px;
        background: #ffffff;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        min-width: 860px;
      }
      th, td {
        border-bottom: 1px solid #e4e9e1;
        padding: 9px 10px;
        text-align: left;
        vertical-align: top;
      }
      th {
        color: #4d5a51;
        font-size: 13px;
      }
      tr:last-child td { border-bottom: 0; }
      td button {
        width: auto;
        min-height: 32px;
        padding: 5px 9px;
      }
      .session-detail {
        margin-top: 18px;
      }
      .event-list {
        display: grid;
        gap: 10px;
      }
      .event-record {
        border: 1px solid #d7ddd2;
        border-radius: 6px;
        background: #ffffff;
        padding: 10px;
      }
      .event-record header {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 8px;
        color: #4d5a51;
        font-size: 13px;
        font-weight: 700;
      }
      .event-record pre {
        max-height: 360px;
        font-size: 12px;
      }
      .pager {
        display: flex;
        gap: 8px;
        align-items: center;
        margin: 12px 0;
      }
      .pager button {
        width: auto;
        min-width: 92px;
        text-align: center;
      }
      .muted {
        color: #647067;
        font-size: 13px;
      }
      .hidden { display: none; }
      .bootstrap-list {
        display: grid;
        gap: 8px;
        padding-left: 0;
        list-style: none;
      }
      .bootstrap-list li {
        display: grid;
        grid-template-columns: 72px minmax(120px, 180px) minmax(0, 1fr);
        gap: 10px;
        align-items: baseline;
      }
      .bootstrap-list span {
        color: #346b45;
        font-size: 13px;
        font-weight: 700;
      }
      .bootstrap-list small {
        color: #647067;
        overflow-wrap: anywhere;
      }
      [role="status"], [role="alert"] {
        min-height: 24px;
        margin-top: 16px;
        color: #346b45;
        font-weight: 650;
      }
      [role="alert"] { color: #a33a27; }
      @media (max-width: 760px) {
        .shell { grid-template-columns: 1fr; }
        aside {
          position: static;
          border-right: 0;
          border-bottom: 1px solid #d7ddd2;
        }
        .hero { grid-template-columns: 1fr; }
        dl { grid-template-columns: 1fr; }
        .session-log-filters { grid-template-columns: 1fr; }
        .bootstrap-list li { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <aside aria-label="Dashboard menu">
        <div class="brand" aria-label="NDX version">
          <strong>NDX</strong>
          <small>Version ${escapeHtml(input.packageVersion)}</small>
        </div>
        <nav aria-label="Server actions">
          <button type="button" id="session-logs-button" class="secondary">Session Logs</button>
          <button type="button" id="reload-button">Reload</button>
          <button type="button" id="exit-button" class="danger">Exit</button>
        </nav>
        <p id="action-status" role="status" data-testid="dashboard-action-status">Dashboard is running.</p>
      </aside>
      <main aria-labelledby="dashboard-title" data-testid="ndx-dashboard">
        <div class="hero">
          <section aria-labelledby="dashboard-title">
            <h1 id="dashboard-title">Server Dashboard</h1>
            <pre aria-label="NDX ASCII art">${DASHBOARD_ASCII_ART}</pre>
          </section>
          <section aria-labelledby="server-info-title">
            <h2 id="server-info-title">Server Information</h2>
            <dl>
              <dt>Socket</dt>
              <dd><code>${escapeHtml(socketUrl)}</code></dd>
              <dt>Dashboard</dt>
              <dd><code>${escapeHtml(dashboardUrl)}</code></dd>
              <dt>Project</dt>
              <dd><code>${escapeHtml(resolve(input.cwd))}</code></dd>
              <dt>Model</dt>
              <dd><code>${escapeHtml(input.config.model)}</code></dd>
              <dt>Bootstrap</dt>
              <dd>${escapeHtml(new Date(input.bootstrap.checkedAt).toISOString())}</dd>
            </dl>
          </section>
        </div>
        <section aria-labelledby="sources-title">
          <h2 id="sources-title">Recognized Sources</h2>
          <ul data-testid="dashboard-sources">${sources}</ul>
        </section>
        <section aria-labelledby="bootstrap-title">
          <h2 id="bootstrap-title">Bootstrap Elements</h2>
          <ul class="bootstrap-list" data-testid="dashboard-bootstrap">${bootstrapRows}</ul>
        </section>
        <section class="session-log-panel" aria-labelledby="session-logs-title" data-testid="dashboard-session-logs">
          <h2 id="session-logs-title">Session Logs</h2>
          <form class="session-log-filters" aria-label="Session log filters">
            <label for="account-filter">Account
              <select id="account-filter" data-filter-category="accounts">
                <option value="">All accounts</option>
              </select>
            </label>
            <label for="project-filter">Project
              <select id="project-filter" data-filter-category="projects">
                <option value="">All projects</option>
              </select>
            </label>
            <label for="session-filter">Session
              <select id="session-filter" data-filter-category="sessions">
                <option value="">All sessions</option>
              </select>
            </label>
          </form>
          <div id="session-log-tags" class="filter-tags" aria-label="Selected session log filters" data-testid="session-log-filter-tags"></div>
          <p id="session-log-status" role="status" data-testid="session-log-status">Session log filters are ready.</p>
          <div class="table-wrap" aria-labelledby="session-log-table-title">
            <h2 id="session-log-table-title" class="hidden">Session Log Table</h2>
            <table data-testid="session-log-table">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Project</th>
                  <th scope="col">Session</th>
                  <th scope="col">Status</th>
                  <th scope="col">Events</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody id="session-log-body"></tbody>
            </table>
          </div>
          <section id="session-detail" class="session-detail hidden" aria-labelledby="session-detail-title" data-testid="session-log-detail">
            <h2 id="session-detail-title">Session Detail</h2>
            <dl id="session-detail-meta"></dl>
            <div class="pager" aria-label="Session event pages">
              <button type="button" id="event-prev">Previous</button>
              <span id="event-page-status" class="muted"></span>
              <button type="button" id="event-next">Next</button>
            </div>
            <div id="event-list" class="event-list" data-testid="session-log-events"></div>
          </section>
        </section>
      </main>
    </div>
    <script>
      const status = document.getElementById("action-status");
      async function postAction(path, pending) {
        status.setAttribute("role", "status");
        status.textContent = pending;
        const response = await fetch(path, { method: "POST" });
        const body = await response.json();
        if (!response.ok || body.ok === false) {
          status.setAttribute("role", "alert");
          status.textContent = body.message || "Action failed.";
          return body;
        }
        status.textContent = body.message || "Action completed.";
        return body;
      }
      document.getElementById("reload-button").addEventListener("click", async () => {
        const body = await postAction("/api/reload", "Reloading configuration.");
        if (body.ok !== false) {
          window.location.reload();
        }
      });
      document.getElementById("exit-button").addEventListener("click", () => {
        void postAction("/api/exit", "Requesting server exit.");
      });
      const selectedFilters = {
        accounts: new Set(),
        projects: new Set(),
        sessions: new Set(),
      };
      const filterLabels = {
        accounts: new Map(),
        projects: new Map(),
        sessions: new Map(),
      };
      let selectedSessionId = "";
      let eventOffset = 0;
      const eventLimit = 50;
      const sessionLogStatus = document.getElementById("session-log-status");
      const sessionLogBody = document.getElementById("session-log-body");
      const sessionDetail = document.getElementById("session-detail");
      const sessionDetailMeta = document.getElementById("session-detail-meta");
      const eventList = document.getElementById("event-list");
      const eventPageStatus = document.getElementById("event-page-status");
      const eventPrev = document.getElementById("event-prev");
      const eventNext = document.getElementById("event-next");

      function setSessionLogStatus(message, failed = false) {
        sessionLogStatus.setAttribute("role", failed ? "alert" : "status");
        sessionLogStatus.textContent = message;
      }
      function option(select, value, label) {
        const entry = document.createElement("option");
        entry.value = value;
        entry.textContent = label;
        select.appendChild(entry);
      }
      function formatTime(value) {
        return new Date(value).toISOString();
      }
      function sessionLabel(session) {
        return "#" + session.sequence + " " + session.title + " (" + session.user + ")";
      }
      async function loadFacets() {
        const response = await fetch("/api/session-log/facets");
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.message || "Failed to load session log filters.");
        }
        const accountFilter = document.getElementById("account-filter");
        const projectFilter = document.getElementById("project-filter");
        const sessionFilter = document.getElementById("session-filter");
        for (const account of body.accounts) {
          filterLabels.accounts.set(account, account);
          option(accountFilter, account, account);
        }
        for (const project of body.projects) {
          filterLabels.projects.set(project, project);
          option(projectFilter, project, project);
        }
        for (const session of body.sessions) {
          const label = sessionLabel(session);
          filterLabels.sessions.set(session.id, label);
          option(sessionFilter, session.id, label);
        }
      }
      function queryString() {
        const params = new URLSearchParams();
        for (const category of Object.keys(selectedFilters)) {
          for (const value of selectedFilters[category]) {
            params.append(category, value);
          }
        }
        const encoded = params.toString();
        return encoded.length === 0 ? "" : "?" + encoded;
      }
      function renderTags() {
        const tags = document.getElementById("session-log-tags");
        tags.replaceChildren();
        for (const category of Object.keys(selectedFilters)) {
          for (const value of selectedFilters[category]) {
            const tag = document.createElement("button");
            tag.type = "button";
            tag.className = "filter-tag";
            tag.textContent = category.slice(0, -1) + ": " + (filterLabels[category].get(value) || value) + " x";
            tag.setAttribute("aria-label", "Remove " + category.slice(0, -1) + " filter " + (filterLabels[category].get(value) || value));
            tag.addEventListener("click", () => {
              selectedFilters[category].delete(value);
              renderTags();
              void loadSessions();
            });
            tags.appendChild(tag);
          }
        }
      }
      async function loadSessions() {
        setSessionLogStatus("Loading session logs.");
        const response = await fetch("/api/session-log/sessions" + queryString());
        const body = await response.json();
        if (!response.ok) {
          setSessionLogStatus(body.message || "Failed to load session logs.", true);
          return;
        }
        renderSessions(body.sessions);
        setSessionLogStatus(body.sessions.length === 0 ? "No sessions match the filters." : "Loaded " + body.sessions.length + " sessions.");
      }
      function renderSessions(sessions) {
        sessionLogBody.replaceChildren();
        for (const session of sessions) {
          const row = document.createElement("tr");
          row.setAttribute("data-testid", "session-log-row");
          const values = [
            session.user,
            session.cwd,
            "#" + session.sequence + " " + session.title,
            session.status,
            String(session.eventCount),
            formatTime(session.updatedAt),
          ];
          for (const value of values) {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
          }
          const actions = document.createElement("td");
          const open = document.createElement("button");
          open.type = "button";
          open.textContent = "Open";
          open.setAttribute("aria-label", "Open session " + session.title);
          open.addEventListener("click", () => {
            selectedSessionId = session.id;
            eventOffset = 0;
            void loadEvents();
          });
          const del = document.createElement("button");
          del.type = "button";
          del.className = "danger";
          del.textContent = "Delete";
          del.setAttribute("aria-label", "Delete session " + session.title);
          del.addEventListener("click", async () => {
            const response = await fetch("/api/session-log/sessions/" + encodeURIComponent(session.id), { method: "DELETE" });
            const body = await response.json();
            if (!response.ok || body.ok === false) {
              setSessionLogStatus(body.message || "Failed to delete session.", true);
              return;
            }
            if (selectedSessionId === session.id) {
              selectedSessionId = "";
              sessionDetail.classList.add("hidden");
            }
            await loadFacetsAndSessions();
            setSessionLogStatus(body.message || "Session deleted.");
          });
          actions.append(open, " ", del);
          row.appendChild(actions);
          sessionLogBody.appendChild(row);
        }
      }
      async function loadEvents() {
        if (selectedSessionId.length === 0) {
          return;
        }
        const response = await fetch("/api/session-log/sessions/" + encodeURIComponent(selectedSessionId) + "/events?offset=" + eventOffset + "&limit=" + eventLimit);
        const body = await response.json();
        if (!response.ok) {
          setSessionLogStatus(body.message || "Failed to load session detail.", true);
          return;
        }
        renderEventPage(body);
      }
      function renderEventPage(page) {
        sessionDetail.classList.remove("hidden");
        sessionDetailMeta.replaceChildren();
        for (const entry of [
          ["Account", page.session.user],
          ["Project", page.session.cwd],
          ["Session", "#" + page.session.sequence + " " + page.session.title],
          ["Status", page.session.status],
          ["Events", String(page.total)],
        ]) {
          const term = document.createElement("dt");
          term.textContent = entry[0];
          const detail = document.createElement("dd");
          detail.textContent = entry[1];
          sessionDetailMeta.append(term, detail);
        }
        eventList.replaceChildren();
        for (const event of page.events) {
          const record = document.createElement("article");
          record.className = "event-record";
          record.setAttribute("data-testid", "session-log-event");
          const header = document.createElement("header");
          header.textContent = "#" + event.id + " " + event.type + " " + (event.msgType || "") + " " + formatTime(event.createdAt);
          const pre = document.createElement("pre");
          pre.textContent = JSON.stringify(event.payload, null, 2);
          record.append(header, pre);
          eventList.appendChild(record);
        }
        eventPageStatus.textContent = (page.offset + 1) + "-" + Math.min(page.offset + page.events.length, page.total) + " of " + page.total;
        eventPrev.disabled = page.offset <= 0;
        eventNext.disabled = page.offset + page.limit >= page.total;
      }
      async function loadFacetsAndSessions() {
        for (const select of document.querySelectorAll("[data-filter-category]")) {
          const first = select.querySelector("option");
          select.replaceChildren(first);
        }
        filterLabels.accounts.clear();
        filterLabels.projects.clear();
        filterLabels.sessions.clear();
        await loadFacets();
        renderTags();
        await loadSessions();
      }
      for (const select of document.querySelectorAll("[data-filter-category]")) {
        select.addEventListener("change", () => {
          const category = select.getAttribute("data-filter-category");
          if (category && select.value.length > 0) {
            selectedFilters[category].add(select.value);
            select.value = "";
            renderTags();
            void loadSessions();
          }
        });
      }
      eventPrev.addEventListener("click", () => {
        eventOffset = Math.max(0, eventOffset - eventLimit);
        void loadEvents();
      });
      eventNext.addEventListener("click", () => {
        eventOffset += eventLimit;
        void loadEvents();
      });
      document.getElementById("session-logs-button").addEventListener("click", () => {
        document.getElementById("session-logs-title").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      void loadFacetsAndSessions().catch((error) => {
        setSessionLogStatus(error instanceof Error ? error.message : String(error), true);
      });
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
