import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

interface WriteMessage {
  type: "write";
  job: {
    id: string;
    dir: string;
    threadId: string;
    record: Record<string, unknown>;
  };
}

process.on("message", (message) => {
  void handleMessage(message);
});

process.on("disconnect", () => {
  process.exit(0);
});

async function handleMessage(message: unknown): Promise<void> {
  if (!isWriteMessage(message)) {
    return;
  }
  try {
    await mkdir(message.job.dir, { recursive: true });
    await appendFile(
      join(message.job.dir, `${message.job.threadId}.jsonl`),
      `${JSON.stringify({
        ...message.job.record,
        persistedAt: Date.now(),
        writerPid: process.pid,
      })}\n`,
    );
    process.send?.({
      type: "write_result",
      jobId: message.job.id,
      ok: true,
    });
  } catch (error) {
    process.send?.({
      type: "write_result",
      jobId: message.job.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function isWriteMessage(message: unknown): message is WriteMessage {
  if (message === null || typeof message !== "object") {
    return false;
  }
  const value = message as Partial<WriteMessage>;
  return (
    value.type === "write" &&
    value.job !== undefined &&
    typeof value.job.id === "string" &&
    typeof value.job.dir === "string" &&
    typeof value.job.threadId === "string" &&
    value.job.record !== null &&
    typeof value.job.record === "object"
  );
}
