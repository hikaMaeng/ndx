export class AgentAbortError extends Error {
  constructor(reason = "aborted") {
    super(`agent aborted: ${reason}`);
    this.name = "AgentAbortError";
  }
}

export function abortReason(signal: AbortSignal): string {
  return signal.reason instanceof Error
    ? signal.reason.message
    : String(signal.reason ?? "aborted");
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new AgentAbortError(abortReason(signal));
  }
}

export function isAgentAbortError(error: unknown): error is AgentAbortError {
  return error instanceof AgentAbortError;
}
