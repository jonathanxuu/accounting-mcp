import fs from 'node:fs';

import { google } from 'googleapis';
import type { sheets_v4 } from 'googleapis';

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
  spreadsheetId?: string;
  sheetName: string;
  serviceAccountKeyFile?: string;
  serviceAccountKeyJson?: string;
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

export class GoogleSheetsSync {
  private readonly enabled: boolean;
  private readonly spreadsheetId?: string;
  private readonly sheetName: string;
  private readonly sheetsApiPromise: Promise<sheets_v4.Sheets> | null;

  constructor(config: SheetsConfig) {
    this.enabled = config.enabled;
    this.spreadsheetId = config.spreadsheetId;
    this.sheetName = config.sheetName;

    if (!config.enabled) {
      this.sheetsApiPromise = null;
      return;
    }

    if (!config.spreadsheetId) {
      throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID is required when Google Sheets sync is enabled');
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

  async syncExpense(expense: ExpenseRecord): Promise<void> {
    if (!this.enabled || !this.sheetsApiPromise || !this.spreadsheetId) {
      return;
    }

    const sheets = await this.sheetsApiPromise;
    const sheetRange = `${this.sheetName}!A:P`;

    await this.ensureHeader(sheets);

    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
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
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A${rowNumber}:P${rowNumber}`,
        valueInputOption: 'RAW',
        requestBody: { values: rowValues },
      });
      return;
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${this.sheetName}!A:P`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rowValues },
    });
  }

  private async ensureHeader(sheets: sheets_v4.Sheets): Promise<void> {
    if (!this.spreadsheetId) {
      return;
    }

    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${this.sheetName}!A1:P1`,
    });

    const header = existing.data.values?.[0] ?? [];
    const missingHeader = HEADER.some((value, index) => header[index] !== value);

    if (!missingHeader) {
      return;
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${this.sheetName}!A1:P1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER] },
    });
  }
}
