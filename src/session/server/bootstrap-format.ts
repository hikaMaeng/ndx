import type {
  NdxBootstrapReport,
  SessionContextSummary,
} from "../../shared/types.js";

export function formatBootstrap(bootstrap: NdxBootstrapReport): string {
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

export function formatContext(
  context: SessionContextSummary | undefined,
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
