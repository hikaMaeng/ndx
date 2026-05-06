export function providerHeaders(
  apiKey: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extra,
  };
  if (apiKey.length > 0) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Response> {
  return await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export async function errorText(response: Response): Promise<string> {
  const text = await response.text();
  return `${response.status} ${text}`;
}
