export type AppConfig = {
  apiKey: string;
  databaseUrl: string;
  host: string;
  allowedHosts: string[];
  port: number;
  sheets: {
    enabled: boolean;
    spreadsheetId?: string;
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

export function loadConfig(): AppConfig {
  const apiKey = process.env.ACCOUNTING_MCP_API_KEY?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!apiKey) {
    throw new Error('Missing ACCOUNTING_MCP_API_KEY environment variable');
  }

  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL environment variable');
  }

  const sheetsEnabled = process.env.GOOGLE_SHEETS_SYNC_ENABLED?.trim() === 'true';

  return {
    apiKey,
    databaseUrl,
    host: process.env.HOST?.trim() || '0.0.0.0',
    allowedHosts: parseAllowedHosts(process.env.ALLOWED_HOSTS),
    port: parsePort(process.env.PORT, 4010),
    sheets: {
      enabled: sheetsEnabled,
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim(),
      sheetName: process.env.GOOGLE_SHEETS_SHEET_NAME?.trim() || 'Expenses',
      serviceAccountKeyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE?.trim(),
      serviceAccountKeyJson: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON?.trim(),
    },
  };
}
