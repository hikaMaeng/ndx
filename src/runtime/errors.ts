import type {
  ClassifiedModelError,
  ModelErrorCode,
} from "../shared/protocol.js";

export function classifyModelError(error: unknown): ClassifiedModelError {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const status = statusCodeFromMessage(message);
  const code = codeForStatus(status, normalized);

  return {
    code,
    recoverable:
      code === "rate_limited" ||
      code === "server_error" ||
      code === "connection_failed",
    message,
  };
}

function statusCodeFromMessage(message: string): number | undefined {
  const match = /\b([1-5][0-9]{2})\b/.exec(message);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function codeForStatus(
  status: number | undefined,
  normalizedMessage: string,
): ModelErrorCode {
  if (status === 401 || status === 403) {
    return "unauthorized";
  }
  if (status === 400 || status === 404 || status === 422) {
    return "bad_request";
  }
  if (status === 429 || normalizedMessage.includes("rate limit")) {
    return "rate_limited";
  }
  if (status !== undefined && status >= 500) {
    return "server_error";
  }
  if (
    normalizedMessage.includes("econnrefused") ||
    normalizedMessage.includes("fetch failed") ||
    normalizedMessage.includes("connection")
  ) {
    return "connection_failed";
  }
  return "unknown";
}
