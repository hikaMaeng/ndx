export type JsonRpcId = number | string | null;

export interface JsonRpcRequest {
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** Return whether a JSON-RPC method may run before socket login. */
export function isPublicMethod(method: string | undefined): boolean {
  return (
    method === "server/info" ||
    method === "account/create" ||
    method === "account/login" ||
    method === "account/socialLogin"
  );
}

/** Format a JSON-RPC error payload. */
export function rpcError(
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  return { code, message, data: data instanceof Error ? data.message : data };
}

/** Convert unknown thrown values to display-safe text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
