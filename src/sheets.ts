import { createHash } from 'node:crypto';
import fs from 'node:fs';

import { google } from 'googleapis';
import type { drive_v3, sheets_v4 } from 'googleapis';

import { UserSpreadsheetRepository, identityEmail } from './sheetMappings.js';
import type {
  McpUserIdentity,
  NewSharedSpreadsheet,
  NewUserSpreadsheet,
  SharedSpreadsheetAccess,
  SharedSpreadsheetMember,
  UserSpreadsheetMapping,
} from './sheetMappings.js';

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

type SpreadsheetTarget = Pick<UserSpreadsheetMapping, 'spreadsheetId' | 'spreadsheetUrl' | 'title'>;

export type WorksheetSyncResult = {
  spreadsheetId: string;
  spreadsheetUrl: string | null;
  worksheetName: string;
  rowCount: number;
  workspaceId: string | null;
  syncMode: 'personal' | 'shared';
};

export type SharedSpreadsheetResult = {
  workspaceId: string;
  spreadsheetId: string;
  spreadsheetUrl: string | null;
  title: string;
  ownerUserKey: string;
  ownerUserLabel: string;
  members: SharedSpreadsheetMember[];
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

const SOURCE_MATERIALS_SHEET_NAME = 'Source Materials';
const SOURCE_MATERIALS_HEADER = [
  'source_material_id',
  'accounting_case_id',
  'workspace_id',
  'uploaded_by',
  'source_type',
  'material_kind',
  'file_ref',
  'content_hash',
  'status',
  'confidence',
  'evidence_refs',
  'raw_text_preview',
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

function buildSharedSpreadsheetTitle(
  baseSheetName: string,
  workspaceId: string,
  explicitTitle?: string,
): string {
  const baseTitle = sanitizeSheetTitle(explicitTitle || baseSheetName) || 'Expenses';
  const workspaceTitle = sanitizeSheetTitle(workspaceId) || identityHash(workspaceId);
  return (
    truncateTitle(`${baseTitle} - Shared - ${workspaceTitle}`, MAX_SPREADSHEET_TITLE_LENGTH) ||
    `Expenses - Shared - ${identityHash(workspaceId)}`
  );
}

function a1Range(sheetName: string, range: string): string {
  return `'${sheetName.replace(/'/g, "''")}'!${range}`;
}

function isDuplicateSheetTitleError(error: unknown): boolean {
  return error instanceof Error && /already exists/i.test(error.message);
}

function isDuplicatePermissionError(error: unknown): boolean {
  return error instanceof Error && /already has permission|duplicate/i.test(error.message);
}

function drivePermissionRole(role: 'editor' | 'viewer'): 'writer' | 'reader' {
  return role === 'editor' ? 'writer' : 'reader';
}

function parseSpreadsheetIdFromUrl(spreadsheetUrl: string): string | null {
  try {
    const url = new URL(spreadsheetUrl);
    const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);

    if (match?.[1]) {
      return match[1];
    }

    return url.searchParams.get('id');
  } catch {
    return null;
  }
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

  private getUserDriveApi(user: McpUserIdentity): drive_v3.Drive {
    if (!user.googleAccessToken) {
      throw new Error('Google Drive sharing requires a user Google access token');
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({
      access_token: user.googleAccessToken,
    });

    return google.drive({ version: 'v3', auth });
  }

  private async getSheetsApi(user: McpUserIdentity): Promise<sheets_v4.Sheets | null> {
    if (this.useUserGoogleAuth) {
      return this.getUserSheetsApi(user);
    }

    return this.sheetsApiPromise;
  }

  private async resolveSpreadsheetTarget(
    sheets: sheets_v4.Sheets,
    user: McpUserIdentity,
    workspaceId?: string,
  ): Promise<SpreadsheetTarget & { workspaceId: string | null; syncMode: 'personal' | 'shared' }> {
    if (workspaceId) {
      const shared = await this.spreadsheetRepository.getSharedSpreadsheet(workspaceId);
      if (shared) {
        const access = await this.requireSharedSpreadsheetAccess(workspaceId, user, 'viewer');
        return {
          spreadsheetId: access.spreadsheetId,
          spreadsheetUrl: access.spreadsheetUrl,
          title: access.title,
          workspaceId,
          syncMode: 'shared',
        };
      }
    }

    const personal = await this.spreadsheetRepository.getOrCreateForUser(
      user,
      () => this.createUserSpreadsheet(sheets, user),
    );
    return {
      spreadsheetId: personal.spreadsheetId,
      spreadsheetUrl: personal.spreadsheetUrl,
      title: personal.title,
      workspaceId: null,
      syncMode: 'personal',
    };
  }

  private async requireSharedSpreadsheetAccess(
    workspaceId: string,
    user: McpUserIdentity,
    minimumRole: 'viewer' | 'editor',
  ): Promise<SharedSpreadsheetAccess> {
    const access = await this.spreadsheetRepository.getSharedSpreadsheetForUser(workspaceId, user);
    if (!access) {
      throw new Error(`User ${user.label} does not have access to shared spreadsheet for workspace ${workspaceId}`);
    }

    if (minimumRole === 'editor' && access.role === 'viewer') {
      throw new Error(`User ${user.label} has viewer-only access to shared spreadsheet for workspace ${workspaceId}`);
    }

    return access;
  }

  private async requireSharedSpreadsheetAccessByLocator(
    input: {
      workspaceId?: string;
      spreadsheetUrl?: string;
    },
    user: McpUserIdentity,
    minimumRole: 'viewer' | 'editor',
  ): Promise<SharedSpreadsheetAccess> {
    if (input.workspaceId) {
      return this.requireSharedSpreadsheetAccess(input.workspaceId, user, minimumRole);
    }

    const spreadsheetUrl = input.spreadsheetUrl?.trim();
    if (!spreadsheetUrl) {
      throw new Error('Either workspaceId or spreadsheetUrl is required');
    }

    const spreadsheetId = parseSpreadsheetIdFromUrl(spreadsheetUrl);
    if (!spreadsheetId) {
      throw new Error(`Could not parse spreadsheet id from URL: ${spreadsheetUrl}`);
    }

    const access = await this.spreadsheetRepository.getSharedSpreadsheetForUserBySpreadsheetId(
      spreadsheetId,
      user,
    );
    if (!access) {
      throw new Error(
        `User ${user.label} does not have access to shared spreadsheet ${spreadsheetId}`,
      );
    }

    if (minimumRole === 'editor' && access.role === 'viewer') {
      throw new Error(
        `User ${user.label} has viewer-only access to shared spreadsheet ${spreadsheetId}`,
      );
    }

    return access;
  }

  async syncExpense(
    expense: ExpenseRecord,
    user: McpUserIdentity,
    input?: {
      workspaceId?: string;
    },
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const sheets = await this.getSheetsApi(user);

    if (!sheets) {
      return;
    }

    const spreadsheet = await this.resolveSpreadsheetTarget(sheets, user, input?.workspaceId);
    const sheetRange = a1Range(this.sheetName, 'A:P');

    await this.ensureDetailSheet(sheets, spreadsheet.spreadsheetId);
    await this.ensureHeader(sheets, spreadsheet.spreadsheetId, this.sheetName, HEADER);

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
      workspaceId?: string;
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

    const spreadsheet = await this.resolveSpreadsheetTarget(sheets, user, input.workspaceId);
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
      workspaceId: spreadsheet.workspaceId,
      syncMode: spreadsheet.syncMode,
    };
  }

  async appendSourceMaterialRow(
    user: McpUserIdentity,
    input: {
      workspaceId: string;
      accountingCaseId: number;
      sourceMaterialId: number;
      uploadedBy: string;
      sourceType: string;
      materialKind: string;
      fileRef: string | null;
      contentHash: string | null;
      status: string;
      confidence: number | null;
      evidenceRefs: string[];
      rawTextPreview: string | null;
      createdAt: string;
      updatedAt: string;
    },
  ): Promise<WorksheetSyncResult> {
    if (!this.enabled) {
      throw new Error('Google Sheets sync is not enabled');
    }

    const sheets = await this.getSheetsApi(user);
    if (!sheets) {
      throw new Error('Google Sheets API is not available');
    }

    const spreadsheet = await this.resolveSpreadsheetTarget(sheets, user, input.workspaceId);
    await this.ensureNamedSheet(sheets, spreadsheet.spreadsheetId, SOURCE_MATERIALS_SHEET_NAME);
    await this.ensureHeader(
      sheets,
      spreadsheet.spreadsheetId,
      SOURCE_MATERIALS_SHEET_NAME,
      SOURCE_MATERIALS_HEADER,
    );

    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheet.spreadsheetId,
      range: a1Range(SOURCE_MATERIALS_SHEET_NAME, 'A:N'),
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [
          [
            String(input.sourceMaterialId),
            String(input.accountingCaseId),
            input.workspaceId,
            input.uploadedBy,
            input.sourceType,
            input.materialKind,
            input.fileRef ?? '',
            input.contentHash ?? '',
            input.status,
            input.confidence ?? '',
            input.evidenceRefs.join(', '),
            input.rawTextPreview ?? '',
            input.createdAt,
            input.updatedAt,
          ],
        ],
      },
    });

    return {
      spreadsheetId: spreadsheet.spreadsheetId,
      spreadsheetUrl: spreadsheet.spreadsheetUrl,
      worksheetName: SOURCE_MATERIALS_SHEET_NAME,
      rowCount: 1,
      workspaceId: spreadsheet.workspaceId,
      syncMode: spreadsheet.syncMode,
    };
  }

  async createSharedSpreadsheet(
    user: McpUserIdentity,
    input: {
      workspaceId: string;
      title?: string;
      memberEmails?: string[];
    },
  ): Promise<SharedSpreadsheetResult> {
    if (!this.enabled) {
      throw new Error('Google Sheets sync is not enabled');
    }

    const sheets = await this.getSheetsApi(user);
    if (!sheets) {
      throw new Error('Google Sheets API is not available');
    }

    const spreadsheet = await this.spreadsheetRepository.getOrCreateForWorkspace(
      input.workspaceId,
      user,
      () => this.createWorkspaceSpreadsheet(sheets, user, input.workspaceId, input.title),
    );

    for (const email of input.memberEmails ?? []) {
      const normalizedEmail = identityEmail(email);
      const normalizedUserEmail = identityEmail(user.label);
      if (!normalizedEmail || normalizedEmail === normalizedUserEmail) {
        continue;
      }

      await this.shareSharedSpreadsheetWithMember(user, {
        workspaceId: input.workspaceId,
        memberEmail: normalizedEmail,
        role: 'editor',
      });
    }

    return {
      workspaceId: spreadsheet.workspaceId,
      spreadsheetId: spreadsheet.spreadsheetId,
      spreadsheetUrl: spreadsheet.spreadsheetUrl,
      title: spreadsheet.title,
      ownerUserKey: spreadsheet.ownerUserKey,
      ownerUserLabel: spreadsheet.ownerUserLabel,
      members: await this.spreadsheetRepository.listSharedSpreadsheetMembers(input.workspaceId),
    };
  }

  async shareSharedSpreadsheetWithMember(
    user: McpUserIdentity,
    input: {
      workspaceId?: string;
      spreadsheetUrl?: string;
      memberEmail: string;
      role: 'editor' | 'viewer';
    },
  ): Promise<SharedSpreadsheetResult> {
    const access = await this.requireSharedSpreadsheetAccessByLocator(input, user, 'editor');
    const drive = this.getUserDriveApi(user);
    await this.ensureDrivePermission(drive, access.spreadsheetId, input.memberEmail, input.role);

    await this.spreadsheetRepository.addSharedSpreadsheetMember({
      workspaceId: access.workspaceId,
      memberIdentity: input.memberEmail.toLowerCase(),
      memberLabel: input.memberEmail,
      memberEmail: input.memberEmail.toLowerCase(),
      role: input.role,
    });

    return this.getSharedSpreadsheetDetails({ workspaceId: access.workspaceId }, user);
  }

  async getSharedSpreadsheetDetails(
    input: {
      workspaceId?: string;
      spreadsheetUrl?: string;
    },
    user: McpUserIdentity,
  ): Promise<SharedSpreadsheetResult> {
    const access = await this.requireSharedSpreadsheetAccessByLocator(input, user, 'viewer');
    return {
      workspaceId: access.workspaceId,
      spreadsheetId: access.spreadsheetId,
      spreadsheetUrl: access.spreadsheetUrl,
      title: access.title,
      ownerUserKey: access.ownerUserKey,
      ownerUserLabel: access.ownerUserLabel,
      members: await this.spreadsheetRepository.listSharedSpreadsheetMembers(access.workspaceId),
    };
  }

  private async ensureDrivePermission(
    drive: drive_v3.Drive,
    fileId: string,
    memberEmail: string,
    role: 'editor' | 'viewer',
  ) {
    try {
      await drive.permissions.create({
        fileId,
        sendNotificationEmail: false,
        requestBody: {
          type: 'user',
          role: drivePermissionRole(role),
          emailAddress: memberEmail,
        },
      });
    } catch (error) {
      if (!isDuplicatePermissionError(error)) {
        throw error;
      }
    }
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

  private async createWorkspaceSpreadsheet(
    sheets: sheets_v4.Sheets,
    user: McpUserIdentity,
    workspaceId: string,
    explicitTitle?: string,
  ): Promise<NewSharedSpreadsheet> {
    const title = buildSharedSpreadsheetTitle(this.sheetName, workspaceId, explicitTitle);
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
          {
            properties: {
              title: SOURCE_MATERIALS_SHEET_NAME,
            },
          },
        ],
      },
      fields: 'spreadsheetId,spreadsheetUrl',
    });
    const spreadsheetId = created.data.spreadsheetId;

    if (!spreadsheetId) {
      throw new Error(
        `Google Sheets did not return a spreadsheet id for shared workspace ${workspaceId} created by ${user.key}`,
      );
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

  private async ensureHeader(
    sheets: sheets_v4.Sheets,
    spreadsheetId: string,
    worksheetName: string,
    headerValues: string[],
  ): Promise<void> {
    const range = a1Range(worksheetName, `A1:${String.fromCharCode(64 + headerValues.length)}1`);
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const header = existing.data.values?.[0] ?? [];
    const missingHeader = headerValues.some((value, index) => header[index] !== value);

    if (!missingHeader) {
      return;
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [headerValues] },
    });
  }
}
