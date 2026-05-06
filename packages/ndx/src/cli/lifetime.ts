const MANAGED_SERVER_SIGNALS: NodeJS.Signals[] = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
  "SIGBREAK",
];

export function managedServerSignalNames(): readonly NodeJS.Signals[] {
  return MANAGED_SERVER_SIGNALS;
}

export async function waitForShutdown(
  managedServer = process.env.NDX_MANAGED_SERVER === "1",
): Promise<void> {
  if (managedServer) {
    await new Promise<void>(() => {
      for (const signal of MANAGED_SERVER_SIGNALS) {
        process.on(signal, () => {
          console.error(
            `[server] ignored ${signal}; use ndxserver stop to stop the managed server`,
          );
        });
      }
    });
    return;
  }
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}
