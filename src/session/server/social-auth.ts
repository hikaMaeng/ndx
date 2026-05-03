export interface SocialProfile {
  subject: string;
  email?: string;
  displayName?: string;
}

/** Fetch and normalize the provider profile for a social login token. */
export async function verifiedSocialProfile(
  provider: string,
  accessToken: string,
): Promise<SocialProfile> {
  if (provider === "github") {
    const profile = await fetchJsonWithBearer(
      "https://api.github.com/user",
      accessToken,
    );
    return {
      subject: String(requiredProfileField(profile, "id")),
      email: optionalProfileString(profile, "email"),
      displayName:
        optionalProfileString(profile, "login") ??
        optionalProfileString(profile, "name"),
    };
  }
  if (provider === "google") {
    const profile = await fetchJsonWithBearer(
      "https://openidconnect.googleapis.com/v1/userinfo",
      accessToken,
    );
    return {
      subject: String(requiredProfileField(profile, "sub")),
      email: optionalProfileString(profile, "email"),
      displayName: optionalProfileString(profile, "name"),
    };
  }
  throw new Error(`unsupported social login provider: ${provider}`);
}

async function fetchJsonWithBearer(
  url: string,
  token: string,
): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "authorization": `Bearer ${token}`,
      "user-agent": "ndx-session-server",
    },
  });
  if (!response.ok) {
    throw new Error(`social login profile request failed: ${response.status}`);
  }
  return response.json();
}

function requiredProfileField(profile: unknown, field: string): unknown {
  if (profile === null || typeof profile !== "object" || !(field in profile)) {
    throw new Error(`social login profile missing ${field}`);
  }
  return (profile as Record<string, unknown>)[field];
}

function optionalProfileString(
  profile: unknown,
  field: string,
): string | undefined {
  if (profile === null || typeof profile !== "object" || !(field in profile)) {
    return undefined;
  }
  const value = (profile as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}
