import type { McpUserIdentity } from './sheetMappings.js';

export type GoogleMcpUserIdentity = McpUserIdentity & {
  googleAccessToken: string;
};

/**
 * The subset of Google's tokeninfo response this server relies on.
 *
 * Unlike the userinfo endpoint, tokeninfo also reports `aud` — the OAuth client
 * the token was minted for — which is what lets us reject tokens issued by
 * unrelated applications. Every field comes back as a string, including
 * `email_verified`.
 */
type GoogleTokenInfo = {
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string;
};

export type GoogleOAuthAccessPolicy = {
  /**
   * OAuth client ids permitted to mint tokens for this server, matched against
   * the token's `aud` claim.
   *
   * Google's tokeninfo endpoint accepts *any* valid Google access token, no
   * matter which application issued it. Without this check, anyone who can mint
   * a token from their own OAuth app authenticates successfully. Leave empty
   * only for trusted, non-public deployments.
   */
  allowedClientIds: string[];
  /** Optional per-address allowlist. Empty means "any address". */
  allowedEmails: string[];
  /** Optional per-domain allowlist. Empty means "any domain". */
  allowedDomains: string[];
};

/**
 * The bearer token could not be validated with Google — missing, malformed,
 * expired, or revoked. Presenting a freshly issued token can succeed, so this
 * maps to HTTP 401 and invites the client to re-run its OAuth flow.
 */
export class GoogleOAuthUnauthorizedError extends Error {
  override readonly name = 'GoogleOAuthUnauthorizedError';
}

/**
 * The token is valid and the caller's identity is known, but this server's
 * access policy refuses them.
 *
 * This must NOT surface as a 401: OAuth clients read 401 as "your token went
 * stale, get a new one", so they re-run the login flow, obtain an equally
 * rejected token, and loop on the sign-in page forever. Re-authenticating can
 * never change the outcome here, so it maps to HTTP 403 instead.
 */
export class GoogleOAuthForbiddenError extends Error {
  override readonly name = 'GoogleOAuthForbiddenError';
}

const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
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

/**
 * Reject tokens minted for an OAuth client this server does not know about.
 * Skipped entirely when no client ids are configured.
 */
function assertAllowedAudience(tokenInfo: GoogleTokenInfo, policy: GoogleOAuthAccessPolicy) {
  if (policy.allowedClientIds.length === 0) {
    return;
  }

  if (!tokenInfo.aud || !policy.allowedClientIds.includes(tokenInfo.aud)) {
    throw new GoogleOAuthForbiddenError(
      `Google OAuth token was issued for client ${tokenInfo.aud ?? 'unknown'}, which is not authorized for this server`,
    );
  }
}

/**
 * Apply the optional email/domain allowlist. Both lists empty means every
 * Google account that clears {@link assertAllowedAudience} is welcome.
 */
function assertAllowedProfile(tokenInfo: GoogleTokenInfo, policy: GoogleOAuthAccessPolicy) {
  if (policy.allowedEmails.length === 0 && policy.allowedDomains.length === 0) {
    return;
  }

  if (!tokenInfo.email) {
    throw new GoogleOAuthForbiddenError('Google OAuth access policy requires an email claim');
  }

  if (!isAllowedEmail(tokenInfo.email, policy)) {
    throw new GoogleOAuthForbiddenError(
      `Google account ${tokenInfo.email} is not authorized for this server`,
    );
  }
}

/**
 * Cache entries are keyed by the policy as well as the token, so tightening the
 * policy can never be served a stale "allowed" verdict from before the change.
 */
function cacheKey(accessToken: string, policy: GoogleOAuthAccessPolicy): string {
  return [
    accessToken,
    policy.allowedClientIds.join(','),
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

  const response = await fetch(
    `${GOOGLE_TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`,
  );

  if (!response.ok) {
    // tokeninfo answers 400 for malformed or expired tokens and 401 for revoked
    // ones. Both mean "this token is unusable", not "this user is banned".
    throw new GoogleOAuthUnauthorizedError(
      `Google OAuth token validation failed with HTTP ${response.status}`,
    );
  }

  const tokenInfo = (await response.json()) as GoogleTokenInfo;

  if (!tokenInfo.sub) {
    throw new GoogleOAuthUnauthorizedError('Google OAuth tokeninfo response did not include sub');
  }

  // tokeninfo serializes booleans as strings, so only an explicit 'false' is a
  // rejection — an absent claim just means the token carries no email scope.
  if (tokenInfo.email && tokenInfo.email_verified === 'false') {
    throw new GoogleOAuthForbiddenError(
      `Google OAuth email is not verified for ${tokenInfo.email}`,
    );
  }

  assertAllowedAudience(tokenInfo, policy);
  assertAllowedProfile(tokenInfo, policy);

  const user: GoogleMcpUserIdentity = {
    key: `google:${tokenInfo.sub}`,
    label: tokenInfo.email ?? tokenInfo.sub,
    googleAccessToken: accessToken,
  };

  tokenCache.set(key, {
    expiresAt: now + TOKEN_CACHE_TTL_MS,
    user,
  });

  return user;
}
