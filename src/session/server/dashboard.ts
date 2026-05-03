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
