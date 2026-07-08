import type { McpUserIdentity } from './sheetMappings.js';

export type GoogleMcpUserIdentity = McpUserIdentity & {
  googleAccessToken: string;
};

type GoogleUserInfo = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
};

export type GoogleOAuthAccessPolicy = {
  allowedEmails: string[];
  allowedDomains: string[];
};

const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

const tokenCache = new Map<
  string,
  {
    expiresAt: number;
    user: GoogleMcpUserIdentity;
  }
>();

function isAllowedEmail(email: string, policy: GoogleOAuthAccessPolicy): boolean {
  const normalizedEmail = email.toLowerCase();
  const domain = normalizedEmail.split('@')[1] ?? '';

  if (policy.allowedEmails.includes(normalizedEmail)) {
    return true;
  }

  return Boolean(domain && policy.allowedDomains.includes(domain));
}

function assertAllowedProfile(profile: GoogleUserInfo, policy: GoogleOAuthAccessPolicy) {
  if (policy.allowedEmails.length === 0 && policy.allowedDomains.length === 0) {
    return;
  }

  if (!profile.email) {
    throw new Error('Google OAuth access policy requires an email claim');
  }

  if (!isAllowedEmail(profile.email, policy)) {
    throw new Error(`Google OAuth user ${profile.email} is not allowed`);
  }
}

function cacheKey(accessToken: string, policy: GoogleOAuthAccessPolicy): string {
  return [
    accessToken,
    policy.allowedEmails.join(','),
    policy.allowedDomains.join(','),
  ].join('|');
}

export async function authenticateGoogleAccessToken(
  accessToken: string,
  policy: GoogleOAuthAccessPolicy,
): Promise<GoogleMcpUserIdentity> {
  const key = cacheKey(accessToken, policy);
  const cached = tokenCache.get(key);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.user;
  }

  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Google OAuth token validation failed with HTTP ${response.status}`);
  }

  const profile = (await response.json()) as GoogleUserInfo;

  if (!profile.sub) {
    throw new Error('Google OAuth userinfo response did not include sub');
  }

  if (profile.email && profile.email_verified === false) {
    throw new Error(`Google OAuth email is not verified for ${profile.email}`);
  }

  assertAllowedProfile(profile, policy);

  const user: GoogleMcpUserIdentity = {
    key: `google:${profile.sub}`,
    label: profile.email ?? profile.name ?? profile.sub,
    googleAccessToken: accessToken,
  };

  tokenCache.set(key, {
    expiresAt: now + TOKEN_CACHE_TTL_MS,
    user,
  });

  return user;
}
