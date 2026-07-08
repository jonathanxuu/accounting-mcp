export type AppConfig = {
  authMode: 'api_key' | 'google_oauth';
  apiKey?: string;
  databaseUrl: string;
  host: string;
  allowedHosts: string[];
  port: number;
  userHeader: string;
  googleOAuthAllowedEmails: string[];
  googleOAuthAllowedDomains: string[];
  sheets: {
    enabled: boolean;
    useUserGoogleAuth: boolean;
    sheetName: string;
    serviceAccountKeyFile?: string;
    serviceAccountKeyJson?: string;
  };
};

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const port = Number.parseInt(value, 10);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return port;
}

function parseAllowedHosts(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function loadConfig(): AppConfig {
  const authMode = (process.env.ACCOUNTING_MCP_AUTH_MODE?.trim() || 'api_key') as
    | 'api_key'
    | 'google_oauth';
  const apiKey = process.env.ACCOUNTING_MCP_API_KEY?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (authMode !== 'api_key' && authMode !== 'google_oauth') {
    throw new Error(`Invalid ACCOUNTING_MCP_AUTH_MODE value: ${authMode}`);
  }

  if (authMode === 'api_key' && !apiKey) {
    throw new Error('Missing ACCOUNTING_MCP_API_KEY environment variable');
  }

  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL environment variable');
  }

  const sheetsEnabled = process.env.GOOGLE_SHEETS_SYNC_ENABLED?.trim() === 'true';

  return {
    authMode,
    apiKey,
    databaseUrl,
    host: process.env.HOST?.trim() || '0.0.0.0',
    allowedHosts: parseAllowedHosts(process.env.ALLOWED_HOSTS),
    port: parsePort(process.env.PORT, 4010),
    userHeader: process.env.ACCOUNTING_MCP_USER_HEADER?.trim() || 'x-accounting-user',
    googleOAuthAllowedEmails: parseCsv(process.env.GOOGLE_OAUTH_ALLOWED_EMAILS),
    googleOAuthAllowedDomains: parseCsv(process.env.GOOGLE_OAUTH_ALLOWED_DOMAINS),
    sheets: {
      enabled: sheetsEnabled,
      useUserGoogleAuth: authMode === 'google_oauth',
      sheetName: process.env.GOOGLE_SHEETS_SHEET_NAME?.trim() || 'Expenses',
      serviceAccountKeyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE?.trim(),
      serviceAccountKeyJson: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON?.trim(),
    },
  };
}
