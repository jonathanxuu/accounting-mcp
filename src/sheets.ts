import { createHash } from 'node:crypto';
import fs from 'node:fs';

import { google } from 'googleapis';
import type { sheets_v4 } from 'googleapis';

import { UserSpreadsheetRepository } from './sheetMappings.js';
import type { McpUserIdentity, NewUserSpreadsheet } from './sheetMappings.js';

type ExpenseRecord = {
  id: number;
  claimant: string;
  amount: number;
  amountCents: number;
  currency: string;
  expenseDate: string;
  description: string;
  category: string;
  status: string;
  submittedBy: string | null;
  notes: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type SheetsConfig = {
  enabled: boolean;
  useUserGoogleAuth: boolean;
  sheetName: string;
  serviceAccountKeyFile?: string;
  serviceAccountKeyJson?: string;
};

export type WorksheetSyncResult = {
  spreadsheetId: string;
  spreadsheetUrl: string | null;
  worksheetName: string;
  rowCount: number;
};

const HEADER = [
  'expense_id',
  'claimant',
  'amount',
  'amount_cents',
  'currency',
  'expense_date',
  'description',
  'category',
  'status',
  'submitted_by',
  'notes',
  'cancelled_at',
  'cancelled_by',
  'cancellation_reason',
  'created_at',
  'updated_at',
];

const INVALID_SHEET_TITLE_CHARS = /[\[\]:*?\/\\]/g;
const MAX_SHEET_TITLE_LENGTH = 100;
const MAX_SPREADSHEET_TITLE_LENGTH = 180;

function sanitizeSheetTitle(value: string): string {
  return value.replace(INVALID_SHEET_TITLE_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

function truncateTitle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength).trim();
}

function identityHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 8);
}

function buildDetailSheetName(sheetName: string): string {
  return truncateTitle(sanitizeSheetTitle(sheetName), MAX_SHEET_TITLE_LENGTH) || 'Expenses';
}

function buildUserSpreadsheetTitle(baseSheetName: string, user: McpUserIdentity): string {
  const baseTitle = sanitizeSheetTitle(baseSheetName) || 'Expenses';
  const userTitle = sanitizeSheetTitle(user.label) || sanitizeSheetTitle(user.key) || 'Unknown';
  const title = `${baseTitle} - ${userTitle}`;
  const hashSuffix = userTitle === user.label.trim() ? '' : `-${identityHash(user.key)}`;

  return (
    truncateTitle(`${title}${hashSuffix}`, MAX_SPREADSHEET_TITLE_LENGTH) ||
    `Expenses - ${identityHash(user.key)}`
  );
}

function a1Range(sheetName: string, range: string): string {
  return `'${sheetName.replace(/'/g, "''")}'!${range}`;
}

function isDuplicateSheetTitleError(error: unknown): boolean {
  return error instanceof Error && /already exists/i.test(error.message);
}

function toRow(expense: ExpenseRecord): string[] {
  return [
    String(expense.id),
    expense.claimant,
    String(expense.amount),
    String(expense.amountCents),
    expense.currency,
    expense.expenseDate,
    expense.description,
    expense.category,
    expense.status,
    expense.submittedBy ?? '',
    expense.notes ?? '',
    expense.cancelledAt ?? '',
    expense.cancelledBy ?? '',
    expense.cancellationReason ?? '',
    expense.createdAt,
    expense.updatedAt,
  ];
}

function toSheetValuesRow(values: unknown[]): string[] {
  return values.map((value) => {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  });
}

export class GoogleSheetsSync {
  private readonly enabled: boolean;
  private readonly useUserGoogleAuth: boolean;
  private readonly sheetName: string;
  private readonly sheetsApiPromise: Promise<sheets_v4.Sheets> | null;
  private readonly knownDetailSheets = new Set<string>();

  constructor(
    config: SheetsConfig,
    private readonly spreadsheetRepository: UserSpreadsheetRepository,
  ) {
    this.enabled = config.enabled;
    this.useUserGoogleAuth = config.useUserGoogleAuth;
    this.sheetName = buildDetailSheetName(config.sheetName);

    if (!config.enabled || config.useUserGoogleAuth) {
      this.sheetsApiPromise = null;
      return;
    }

    const credentials = this.loadCredentials(config);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheetsApiPromise = Promise.resolve(google.sheets({ version: 'v4', auth }));
  }

  private loadCredentials(config: SheetsConfig) {
    if (config.serviceAccountKeyJson) {
      return JSON.parse(config.serviceAccountKeyJson);
    }

    if (config.serviceAccountKeyFile) {
      return JSON.parse(fs.readFileSync(config.serviceAccountKeyFile, 'utf8'));
    }

    throw new Error(
      'Google Sheets sync requires GOOGLE_SERVICE_ACCOUNT_KEY_JSON or GOOGLE_SERVICE_ACCOUNT_KEY_FILE',
    );
  }

  private getUserSheetsApi(user: McpUserIdentity): sheets_v4.Sheets {
    if (!user.googleAccessToken) {
      throw new Error('Google OAuth Sheets sync requires a user Google access token');
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({
      access_token: user.googleAccessToken,
    });

    return google.sheets({ version: 'v4', auth });
  }

  private async getSheetsApi(user: McpUserIdentity): Promise<sheets_v4.Sheets | null> {
    if (this.useUserGoogleAuth) {
      return this.getUserSheetsApi(user);
    }

    return this.sheetsApiPromise;
  }

  async syncExpense(expense: ExpenseRecord, user: McpUserIdentity): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const sheets = await this.getSheetsApi(user);

    if (!sheets) {
      return;
    }

    const spreadsheet = await this.spreadsheetRepository.getOrCreateForUser(
      user,
      () => this.createUserSpreadsheet(sheets, user),
    );
    const sheetRange = a1Range(this.sheetName, 'A:P');

    await this.ensureDetailSheet(sheets, spreadsheet.spreadsheetId);
    await this.ensureHeader(sheets, spreadsheet.spreadsheetId);

    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheet.spreadsheetId,
      range: sheetRange,
    });

    const rows = existing.data.values ?? [];
    const targetRowIndex = rows.findIndex(
      (row: string[], index: number) => index > 0 && row[0] === String(expense.id),
    );
    const rowValues = [toRow(expense)];

    if (targetRowIndex >= 0) {
      const rowNumber = targetRowIndex + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheet.spreadsheetId,
        range: a1Range(this.sheetName, `A${rowNumber}:P${rowNumber}`),
        valueInputOption: 'RAW',
        requestBody: { values: rowValues },
      });
      return;
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheet.spreadsheetId,
      range: sheetRange,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rowValues },
    });
  }

  async syncWorksheetView(
    user: McpUserIdentity,
    input: {
      worksheetName: string;
      header: string[];
      rows: unknown[][];
    },
  ): Promise<WorksheetSyncResult> {
    if (!this.enabled) {
      throw new Error('Google Sheets sync is not enabled');
    }

    const sheets = await this.getSheetsApi(user);
    if (!sheets) {
      throw new Error('Google Sheets API is not available');
    }

    const spreadsheet = await this.spreadsheetRepository.getOrCreateForUser(
      user,
      () => this.createUserSpreadsheet(sheets, user),
    );

    const worksheetName = buildDetailSheetName(input.worksheetName);
    await this.ensureNamedSheet(sheets, spreadsheet.spreadsheetId, worksheetName);

    const values = [input.header, ...input.rows.map(toSheetValuesRow)];
    await sheets.spreadsheets.values.clear({
      spreadsheetId: spreadsheet.spreadsheetId,
      range: a1Range(worksheetName, 'A:ZZ'),
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheet.spreadsheetId,
      range: a1Range(worksheetName, 'A1'),
      valueInputOption: 'RAW',
      requestBody: {
        values,
      },
    });

    return {
      spreadsheetId: spreadsheet.spreadsheetId,
      spreadsheetUrl: spreadsheet.spreadsheetUrl,
      worksheetName,
      rowCount: input.rows.length,
    };
  }

  private async createUserSpreadsheet(
    sheets: sheets_v4.Sheets,
    user: McpUserIdentity,
  ): Promise<NewUserSpreadsheet> {
    const title = buildUserSpreadsheetTitle(this.sheetName, user);
    const created = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title,
        },
        sheets: [
          {
            properties: {
              title: this.sheetName,
            },
          },
        ],
      },
      fields: 'spreadsheetId,spreadsheetUrl',
    });
    const spreadsheetId = created.data.spreadsheetId;

    if (!spreadsheetId) {
      throw new Error(`Google Sheets did not return a spreadsheet id for MCP user ${user.key}`);
    }

    return {
      spreadsheetId,
      spreadsheetUrl: created.data.spreadsheetUrl ?? null,
      title,
    };
  }

  private async ensureDetailSheet(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<void> {
    await this.ensureNamedSheet(sheets, spreadsheetId, this.sheetName);
  }

  private async ensureNamedSheet(
    sheets: sheets_v4.Sheets,
    spreadsheetId: string,
    sheetName: string,
  ): Promise<void> {
    const cacheKey = `${spreadsheetId}:${sheetName}`;

    if (this.knownDetailSheets.has(cacheKey)) {
      return;
    }

    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(properties(title))',
    });
    const existingTitles =
      spreadsheet.data.sheets
        ?.map((sheet) => sheet.properties?.title)
        .filter((title): title is string => Boolean(title)) ?? [];

    if (existingTitles.includes(sheetName)) {
      this.knownDetailSheets.add(cacheKey);
      return;
    }

    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName,
                },
              },
            },
          ],
        },
      });
    } catch (error) {
      if (!isDuplicateSheetTitleError(error)) {
        throw error;
      }
    }

    this.knownDetailSheets.add(cacheKey);
  }

  private async ensureHeader(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<void> {
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: a1Range(this.sheetName, 'A1:P1'),
    });

    const header = existing.data.values?.[0] ?? [];
    const missingHeader = HEADER.some((value, index) => header[index] !== value);

    if (!missingHeader) {
      return;
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: a1Range(this.sheetName, 'A1:P1'),
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER] },
    });
  }
}
