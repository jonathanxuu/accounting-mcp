import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';

import { GoogleDriveFiles } from './drive.js';
import { ExpenseRepository } from './repository.js';
import type { McpUserIdentity } from './sheetMappings.js';
import { GoogleSheetsSync } from './sheets.js';
import { WorkflowRepository } from './workflowRepository.js';
import {
  addExpenseSchema,
  abortGoogleDriveUploadSchema,
  cancelExpenseSchema,
  createSharedGoogleSheetSchema,
  createGoogleDriveFolderSchema,
  createGoogleDriveTextFileSchema,
  deleteSavedViewSchema,
  getSharedGoogleSheetSchema,
  ingestSourceMaterialSchema,
  appendGoogleDriveUploadChunkSchema,
  listGoogleDriveFilesSchema,
  listExpensesSchema,
  listReconciliationLinksSchema,
  listSavedViewsSchema,
  listReviewItemsSchema,
  moveGoogleDriveFileSchema,
  readGoogleDriveFileSchema,
  runSavedViewSchema,
  searchAccountingRecordsSchema,
  shareSharedGoogleSheetSchema,
  startGoogleDriveUploadSchema,
  summarySchema,
  uploadGoogleDriveFileAutoSchema,
  uploadGoogleDriveFileSchema,
  updateGoogleDriveFileSchema,
  upsertAccountingCaseSchema,
  upsertAccountingRecordSchema,
  upsertReconciliationLinkSchema,
  upsertReviewItemSchema,
  finishGoogleDriveUploadSchema,
} from './schema.js';

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function chooseWorksheetName(
  explicitWorksheetName: string | undefined,
  savedViewName: string | undefined,
  fallback: string,
): string {
  return explicitWorksheetName ?? savedViewName ?? fallback;
}

async function syncWorksheetViewIfEnabled(
  sync: GoogleSheetsSync | null,
  user: McpUserIdentity | null,
  input:
    | {
        workspaceId?: string;
        worksheetName: string;
        header: string[];
        rows: unknown[][];
      }
    | null,
) {
  if (!sync || !input) {
    return null;
  }

  if (!user) {
    throw new Error('Google Sheets sync requires an MCP user identity');
  }

  try {
    const result = await sync.syncWorksheetView(user, input);
    return {
      ok: true,
      error: null,
      ...result,
    };
  } catch (error) {
    console.error('Failed to sync worksheet view to Google Sheets', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown Google Sheets sync error',
      spreadsheetId: null,
      spreadsheetUrl: null,
      worksheetName: input.worksheetName,
      rowCount: input.rows.length,
      workspaceId: input.workspaceId ?? null,
      syncMode: input.workspaceId ? 'shared' : 'personal',
    };
  }
}

function recordSearchWorksheetRows(result: {
  items: Array<{
    id: number;
    recordFamily: string;
    counterparty: string | null;
    amount: number;
    amountCents: number;
    currency: string;
    recordDate: string;
    documentNo: string | null;
    status: string;
    description: string | null;
    case: {
      id: number;
      workspaceId: string;
      clientEntityId: string;
      accountingPeriod: string;
      serviceScope: string;
      status: string;
    };
  }>;
}) {
  return {
    header: [
      'record_id',
      'accounting_case_id',
      'workspace_id',
      'client_entity_id',
      'accounting_period',
      'service_scope',
      'case_status',
      'record_family',
      'counterparty',
      'amount',
      'amount_cents',
      'currency',
      'record_date',
      'document_no',
      'record_status',
      'description',
    ],
    rows: result.items.map((item) => [
      item.id,
      item.case.id,
      item.case.workspaceId,
      item.case.clientEntityId,
      item.case.accountingPeriod,
      item.case.serviceScope,
      item.case.status,
      item.recordFamily,
      item.counterparty,
      item.amount,
      item.amountCents,
      item.currency,
      item.recordDate,
      item.documentNo,
      item.status,
      item.description,
    ]),
  };
}

function reviewItemWorksheetRows(result: {
  items: Array<{
    id: number;
    accountingCaseId: number;
    issueType: string;
    status: string;
    priority: string;
    assignee: string | null;
    summary: string;
    details: string | null;
    resolutionNotes: string | null;
    linkedRecordIds: number[];
    linkedMaterialIds: number[];
    case: {
      id: number;
      workspaceId: string;
      clientEntityId: string;
      accountingPeriod: string;
      serviceScope: string;
      status: string;
    };
  }>;
}) {
  return {
    header: [
      'review_item_id',
      'accounting_case_id',
      'workspace_id',
      'client_entity_id',
      'accounting_period',
      'service_scope',
      'case_status',
      'issue_type',
      'review_status',
      'priority',
      'assignee',
      'summary',
      'details',
      'resolution_notes',
      'linked_record_ids',
      'linked_material_ids',
    ],
    rows: result.items.map((item) => [
      item.id,
      item.case.id,
      item.case.workspaceId,
      item.case.clientEntityId,
      item.case.accountingPeriod,
      item.case.serviceScope,
      item.case.status,
      item.issueType,
      item.status,
      item.priority,
      item.assignee,
      item.summary,
      item.details,
      item.resolutionNotes,
      item.linkedRecordIds,
      item.linkedMaterialIds,
    ]),
  };
}

function pickDefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null),
  ) as Partial<T>;
}

function requireMcpUser(user: McpUserIdentity | null): McpUserIdentity {
  if (!user) {
    throw new Error('This MCP server requires an authenticated user identity');
  }

  return user;
}

async function syncExpenseIfEnabled(
  sync: GoogleSheetsSync | null,
  expense: unknown,
  user: McpUserIdentity | null,
): Promise<string | null> {
  if (!sync) {
    return null;
  }

  if (!user) {
    throw new Error('Google Sheets sync requires an MCP user identity');
  }

  try {
    await sync.syncExpense(
      expense as {
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
      },
      user,
    );
    return null;
  } catch (error) {
    console.error('Failed to sync expense to Google Sheets', error);
    return error instanceof Error ? error.message : 'Unknown Google Sheets sync error';
  }
}

export function createAccountingServer(
  repository: ExpenseRepository,
  workflowRepository: WorkflowRepository,
  sheetsSync: GoogleSheetsSync | null,
  mcpUser: McpUserIdentity | null,
) {
  const server = new McpServer({
    name: 'accounting-mcp',
    version: '0.1.0',
  });
  const driveFiles = new GoogleDriveFiles();

  server.registerTool(
    'create_shared_google_sheet',
    {
      title: 'Create Shared Google Sheet',
      description:
        'Create or reuse one shared Google Sheet for a workspace, owned by the current Google OAuth user, and optionally share it with additional member emails.',
      inputSchema: createSharedGoogleSheetSchema.shape,
    },
    async (input) => {
      if (!sheetsSync) {
        throw new Error('Google Sheets sync is not enabled');
      }

      const user = requireMcpUser(mcpUser);
      const parsed = createSharedGoogleSheetSchema.parse(input);
      const result = await sheetsSync.createSharedSpreadsheet(user, parsed);

      return {
        content: [
          {
            type: 'text',
            text: `Shared Google Sheet ready for workspace ${result.workspaceId}.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'share_shared_google_sheet',
    {
      title: 'Share Shared Google Sheet',
      description:
        'Grant a user access to an existing workspace shared Google Sheet and register them as a workspace collaborator.',
      inputSchema: shareSharedGoogleSheetSchema.shape,
    },
    async (input) => {
      if (!sheetsSync) {
        throw new Error('Google Sheets sync is not enabled');
      }

      const user = requireMcpUser(mcpUser);
      const parsed = shareSharedGoogleSheetSchema.parse(input);
      const result = await sheetsSync.shareSharedSpreadsheetWithMember(user, parsed);

      return {
        content: [
          {
            type: 'text',
            text: `Shared workspace ${result.workspaceId} with ${parsed.memberEmail}.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'get_shared_google_sheet',
    {
      title: 'Get Shared Google Sheet',
      description:
        'Get the current shared Google Sheet and member list for a workspace if the current user has access.',
      inputSchema: getSharedGoogleSheetSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      if (!sheetsSync) {
        throw new Error('Google Sheets sync is not enabled');
      }

      const user = requireMcpUser(mcpUser);
      const parsed = getSharedGoogleSheetSchema.parse(input);
      const result = await sheetsSync.getSharedSpreadsheetDetails(parsed.workspaceId, user);

      return {
        content: [
          {
            type: 'text',
            text: `Loaded shared Google Sheet for workspace ${result.workspaceId}.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'list_google_drive_files',
    {
      title: 'List Google Drive Files',
      description:
        'List the current Google OAuth user’s Google Drive files with optional query, folder, or mime-type filters.',
      inputSchema: listGoogleDriveFilesSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = listGoogleDriveFilesSchema.parse(input);
      const result = await driveFiles.listFiles(user, parsed);

      return {
        content: [
          {
            type: 'text',
            text: `Found ${result.items.length} Google Drive files.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'read_google_drive_file',
    {
      title: 'Read Google Drive File',
      description:
        'Read a Google Docs document or text-like Google Drive file using the current Google OAuth user token.',
      inputSchema: readGoogleDriveFileSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = readGoogleDriveFileSchema.parse(input);
      const result = await driveFiles.readFile(user, parsed.fileId);

      return {
        content: [
          {
            type: 'text',
            text: `Read Google Drive file ${result.name}.`,
          },
          {
            type: 'text',
            text: result.content,
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'update_google_drive_file',
    {
      title: 'Update Google Drive File',
      description:
        'Replace the full content of a Google Docs document or text-like Google Drive file using the current Google OAuth user token.',
      inputSchema: updateGoogleDriveFileSchema.shape,
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = updateGoogleDriveFileSchema.parse(input);
      const result = await driveFiles.updateFile(user, parsed);

      return {
        content: [
          {
            type: 'text',
            text: `Updated Google Drive file ${result.name}.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'move_google_drive_file',
    {
      title: 'Move Google Drive File',
      description:
        'Move a Google Drive file into a target folder for the current Google OAuth user.',
      inputSchema: moveGoogleDriveFileSchema.shape,
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = moveGoogleDriveFileSchema.parse(input);
      const result = await driveFiles.moveFile(user, parsed);

      return {
        content: [
          {
            type: 'text',
            text: `Moved Google Drive file ${result.name} into folder ${result.destinationFolderId}.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'create_google_drive_folder',
    {
      title: 'Create Google Drive Folder',
      description:
        'Create a Google Drive folder for the current Google OAuth user, optionally under a parent folder.',
      inputSchema: createGoogleDriveFolderSchema.shape,
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = createGoogleDriveFolderSchema.parse(input);
      const result = await driveFiles.createFolder(user, parsed);

      return {
        content: [
          {
            type: 'text',
            text: `Created Google Drive folder ${result.name}.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'create_google_drive_text_file',
    {
      title: 'Create Google Drive Text File',
      description:
        'Create a Google Docs document or text-like Google Drive file for the current Google OAuth user. Do not use this tool for PDFs, images, Office files, archives, or other binary uploads; use upload_google_drive_file_auto instead.',
      inputSchema: createGoogleDriveTextFileSchema.shape,
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = createGoogleDriveTextFileSchema.parse(input);
      const result = await driveFiles.createFile(user, parsed);

      return {
        content: [
          {
            type: 'text',
            text: `Created Google Drive file ${result.name}.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'upload_google_drive_file_auto',
    {
      title: 'Upload Google Drive File Automatically',
      description:
        'Upload any binary or non-text file such as PDF, image, Office document, archive, audio, or video to Google Drive. The server automatically chooses the safer upload strategy based on content size. Agents should prefer this tool over guessing between small-file and chunked uploads.',
      inputSchema: uploadGoogleDriveFileAutoSchema.shape,
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = uploadGoogleDriveFileAutoSchema.parse(input);
      const result = await driveFiles.uploadFileAuto(user, parsed);

      return {
        content: [
          {
            type: 'text',
            text: `Uploaded Google Drive file ${result.name} using ${result.uploadStrategy} mode.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'upload_google_drive_file',
    {
      title: 'Upload Google Drive File',
      description:
        'Upload a smaller file to Google Drive in a single call using base64 content.',
      inputSchema: uploadGoogleDriveFileSchema.shape,
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = uploadGoogleDriveFileSchema.parse(input);
      const result = await driveFiles.uploadFile(user, parsed);

      return {
        content: [
          {
            type: 'text',
            text: `Uploaded Google Drive file ${result.name}.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'start_google_drive_upload',
    {
      title: 'Start Google Drive Upload',
      description:
        'Start a chunked Google Drive upload session for larger files and receive an upload session id.',
      inputSchema: startGoogleDriveUploadSchema.shape,
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = startGoogleDriveUploadSchema.parse(input);
      const result = await driveFiles.startUpload(user, parsed);

      return {
        content: [
          {
            type: 'text',
            text: `Started Google Drive upload session ${result.uploadId} for ${result.name}.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'append_google_drive_upload_chunk',
    {
      title: 'Append Google Drive Upload Chunk',
      description:
        'Append one base64-encoded chunk to a previously started Google Drive upload session.',
      inputSchema: appendGoogleDriveUploadChunkSchema.shape,
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = appendGoogleDriveUploadChunkSchema.parse(input);
      const result = await driveFiles.appendUploadChunk(user, parsed);

      return {
        content: [
          {
            type: 'text',
            text: `Appended chunk to Google Drive upload session ${result.uploadId}.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'finish_google_drive_upload',
    {
      title: 'Finish Google Drive Upload',
      description:
        'Finish a chunked Google Drive upload session and create the final Drive file.',
      inputSchema: finishGoogleDriveUploadSchema.shape,
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = finishGoogleDriveUploadSchema.parse(input);
      const result = await driveFiles.finishUpload(user, parsed.uploadId);

      return {
        content: [
          {
            type: 'text',
            text: `Finished Google Drive upload for ${result.name}.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'abort_google_drive_upload',
    {
      title: 'Abort Google Drive Upload',
      description:
        'Abort a chunked Google Drive upload session and delete the temporary staged file.',
      inputSchema: abortGoogleDriveUploadSchema.shape,
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = abortGoogleDriveUploadSchema.parse(input);
      const result = await driveFiles.abortUpload(user, parsed.uploadId);

      return {
        content: [
          {
            type: 'text',
            text: `Aborted Google Drive upload session ${result.uploadId}.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'upsert_accounting_case',
    {
      title: 'Upsert Accounting Case',
      description:
        'Create or update an accounting case that groups materials, records, review items, and future reconciliations.',
      inputSchema: upsertAccountingCaseSchema.shape,
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = upsertAccountingCaseSchema.parse(input);
      const saved = await workflowRepository.upsertAccountingCase(parsed, user);

      return {
        content: [
          {
            type: 'text',
            text: `Accounting case ${saved.id} saved with status ${saved.status}.`,
          },
          {
            type: 'text',
            text: formatJson(saved),
          },
        ],
        structuredContent: saved,
      };
    },
  );

  server.registerTool(
    'ingest_source_material',
    {
      title: 'Ingest Source Material',
      description:
        'Store original accounting evidence such as receipts, invoices, screenshots, statements, or pasted text.',
      inputSchema: ingestSourceMaterialSchema.shape,
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = ingestSourceMaterialSchema.parse(input);
      const saved = await workflowRepository.ingestSourceMaterial(parsed, user);
      const accountingCase = await workflowRepository.getAccountingCase(saved.accountingCaseId, user);
      let sheetSync: {
        ok: boolean;
        error: string | null;
        spreadsheetId: string | null;
        spreadsheetUrl: string | null;
        worksheetName: string;
        rowCount: number;
        workspaceId: string | null;
        syncMode: 'personal' | 'shared';
      } | null = null;

      if (sheetsSync) {
        try {
          const result = await sheetsSync.appendSourceMaterialRow(user, {
            workspaceId: accountingCase.workspaceId,
            accountingCaseId: saved.accountingCaseId,
            sourceMaterialId: saved.id,
            uploadedBy: user.label,
            sourceType: saved.sourceType,
            materialKind: saved.materialKind,
            fileRef: saved.fileRef,
            contentHash: saved.contentHash,
            status: saved.status,
            confidence: saved.confidence,
            evidenceRefs: saved.evidenceRefs,
            rawTextPreview: saved.rawText ? saved.rawText.slice(0, 500) : null,
            createdAt: saved.createdAt,
            updatedAt: saved.updatedAt,
          });
          sheetSync = {
            ok: true,
            error: null,
            ...result,
          };
        } catch (error) {
          console.error('Failed to sync source material to Google Sheets', error);
          sheetSync = {
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown Google Sheets sync error',
            spreadsheetId: null,
            spreadsheetUrl: null,
            worksheetName: 'Source Materials',
            rowCount: 1,
            workspaceId: accountingCase.workspaceId,
            syncMode: 'shared',
          };
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: sheetSync?.ok
              ? `Source material ${saved.id} saved for accounting case ${saved.accountingCaseId} and synced to worksheet ${sheetSync.worksheetName}.`
              : sheetSync?.error
                ? `Source material ${saved.id} saved for accounting case ${saved.accountingCaseId}. Worksheet sync failed: ${sheetSync.error}`
                : `Source material ${saved.id} saved for accounting case ${saved.accountingCaseId}.`,
          },
          {
            type: 'text',
            text: formatJson(saved),
          },
        ],
        structuredContent: {
          ...saved,
          sheetSync,
        },
      };
    },
  );

  server.registerTool(
    'upsert_accounting_record',
    {
      title: 'Upsert Accounting Record',
      description:
        'Create or update a structured accounting record such as an expense claim, vendor bill, customer invoice, or bank transaction.',
      inputSchema: upsertAccountingRecordSchema.shape,
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = upsertAccountingRecordSchema.parse(input);
      const saved = await workflowRepository.upsertAccountingRecord(parsed, user);

      return {
        content: [
          {
            type: 'text',
            text: `Accounting record ${saved.id} saved in family ${saved.recordFamily}.`,
          },
          {
            type: 'text',
            text: formatJson(saved),
          },
        ],
        structuredContent: saved,
      };
    },
  );

  server.registerTool(
    'upsert_reconciliation_link',
    {
      title: 'Upsert Reconciliation Link',
      description:
        'Create or update a reconciliation relationship between two accounting records, including proposed, confirmed, rejected, or voided matches.',
      inputSchema: upsertReconciliationLinkSchema.shape,
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = upsertReconciliationLinkSchema.parse(input);
      const saved = await workflowRepository.upsertReconciliationLink(parsed, user);

      return {
        content: [
          {
            type: 'text',
            text: `Reconciliation link ${saved.id} saved with status ${saved.status}.`,
          },
          {
            type: 'text',
            text: formatJson(saved),
          },
        ],
        structuredContent: saved,
      };
    },
  );

  server.registerTool(
    'list_reconciliation_links',
    {
      title: 'List Reconciliation Links',
      description:
        'List reconciliation relationships between accounting records, with filters by case, source/target record, status, amount, currency, or text query.',
      inputSchema: listReconciliationLinksSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = listReconciliationLinksSchema.parse(input);
      const result = await workflowRepository.listReconciliationLinks(parsed, user);

      return {
        content: [
          {
            type: 'text',
            text: `Found ${result.totals.linkCount} matching reconciliation links.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'list_saved_views',
    {
      title: 'List Saved Views',
      description:
        'List previously saved accounting query views for the current user, optionally filtered by view type or name.',
      inputSchema: listSavedViewsSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = listSavedViewsSchema.parse(input);
      const result = await workflowRepository.listSavedViews(parsed, user);

      return {
        content: [
          {
            type: 'text',
            text: `Found ${result.total} saved views.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'search_accounting_records',
    {
      title: 'Search Accounting Records',
      description:
        'Search structured accounting records across cases, record families, statuses, dates, and document numbers.',
      inputSchema: searchAccountingRecordsSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = searchAccountingRecordsSchema.parse(input);
      const result = await workflowRepository.searchAccountingRecords(parsed, user);
      const worksheetData = parsed.syncToWorksheet
        ? recordSearchWorksheetRows(result)
        : null;
      const sheetSync = await syncWorksheetViewIfEnabled(
        sheetsSync,
        user,
        worksheetData
            ? {
                workspaceId: parsed.workspaceId,
                worksheetName: chooseWorksheetName(
                  parsed.worksheetName,
                  parsed.saveViewName,
                'Accounting Records',
              ),
              ...worksheetData,
            }
          : null,
      );

      return {
        content: [
          {
            type: 'text',
            text: sheetSync?.ok
              ? `Found ${result.totals.recordCount} matching accounting records. Synced worksheet ${sheetSync.worksheetName}.`
              : sheetSync?.error
                ? `Found ${result.totals.recordCount} matching accounting records. Worksheet sync failed: ${sheetSync.error}`
                : `Found ${result.totals.recordCount} matching accounting records.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: {
          ...result,
          sheetSync,
        },
      };
    },
  );

  server.registerTool(
    'delete_saved_view',
    {
      title: 'Delete Saved View',
      description:
        'Delete a previously saved accounting query view by id or name for the current user.',
      inputSchema: deleteSavedViewSchema.shape,
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = deleteSavedViewSchema.parse(input);
      const result = await workflowRepository.deleteSavedView(parsed, user);

      return {
        content: [
          {
            type: 'text',
            text: `Deleted saved view ${result.savedView.name}.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'run_saved_view',
    {
      title: 'Run Saved View',
      description:
        'Re-run a saved accounting query view by id or name, and optionally sync the result into a Google Sheets worksheet.',
      inputSchema: runSavedViewSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = runSavedViewSchema.parse(input);
      const savedView = await workflowRepository.getSavedView(parsed, user);

      if (savedView.viewType === 'search_accounting_records') {
        const replayInput = searchAccountingRecordsSchema.parse({
          ...savedView.filters,
          saveViewName: undefined,
          syncToWorksheet: parsed.syncToWorksheet,
          worksheetName: parsed.worksheetName ?? savedView.worksheetName ?? undefined,
        });
        const result = await workflowRepository.searchAccountingRecords(replayInput, user);
        const worksheetData = replayInput.syncToWorksheet ? recordSearchWorksheetRows(result) : null;
        const sheetSync = await syncWorksheetViewIfEnabled(
          sheetsSync,
          user,
          worksheetData
            ? {
                workspaceId: replayInput.workspaceId,
                worksheetName: chooseWorksheetName(
                  replayInput.worksheetName,
                  savedView.name,
                  'Accounting Records',
                ),
                ...worksheetData,
              }
            : null,
        );

        return {
          content: [
            {
              type: 'text',
              text: sheetSync?.ok
                ? `Ran saved view ${savedView.name}. Found ${result.totals.recordCount} accounting records and synced worksheet ${sheetSync.worksheetName}.`
                : sheetSync?.error
                  ? `Ran saved view ${savedView.name}. Found ${result.totals.recordCount} accounting records. Worksheet sync failed: ${sheetSync.error}`
                  : `Ran saved view ${savedView.name}. Found ${result.totals.recordCount} accounting records.`,
            },
            {
              type: 'text',
              text: formatJson(result),
            },
          ],
          structuredContent: {
            savedView,
            result,
            sheetSync,
          },
        };
      }

      if (savedView.viewType === 'list_review_items') {
        const replayInput = listReviewItemsSchema.parse({
          ...savedView.filters,
          saveViewName: undefined,
          syncToWorksheet: parsed.syncToWorksheet,
          worksheetName: parsed.worksheetName ?? savedView.worksheetName ?? undefined,
        });
        const result = await workflowRepository.listReviewItems(replayInput, user);
        const worksheetData = replayInput.syncToWorksheet ? reviewItemWorksheetRows(result) : null;
        const sheetSync = await syncWorksheetViewIfEnabled(
          sheetsSync,
          user,
          worksheetData
            ? {
                workspaceId: replayInput.workspaceId,
                worksheetName: chooseWorksheetName(
                  replayInput.worksheetName,
                  savedView.name,
                  'Review Items',
                ),
                ...worksheetData,
              }
            : null,
        );

        return {
          content: [
            {
              type: 'text',
              text: sheetSync?.ok
                ? `Ran saved view ${savedView.name}. Found ${result.total} review items and synced worksheet ${sheetSync.worksheetName}.`
                : sheetSync?.error
                  ? `Ran saved view ${savedView.name}. Found ${result.total} review items. Worksheet sync failed: ${sheetSync.error}`
                  : `Ran saved view ${savedView.name}. Found ${result.total} review items.`,
            },
            {
              type: 'text',
              text: formatJson(result),
            },
          ],
          structuredContent: {
            savedView,
            result,
            sheetSync,
          },
        };
      }

      throw new Error(`Unsupported saved view type: ${savedView.viewType}`);
    },
  );

  server.registerTool(
    'upsert_review_item',
    {
      title: 'Upsert Review Item',
      description:
        'Create or update an exception, open issue, or missing-information item that needs accounting follow-up.',
      inputSchema: upsertReviewItemSchema.shape,
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = upsertReviewItemSchema.parse(input);
      const saved = await workflowRepository.upsertReviewItem(parsed, user);

      return {
        content: [
          {
            type: 'text',
            text: `Review item ${saved.id} saved with status ${saved.status}.`,
          },
          {
            type: 'text',
            text: formatJson(saved),
          },
        ],
        structuredContent: saved,
      };
    },
  );

  server.registerTool(
    'list_review_items',
    {
      title: 'List Review Items',
      description:
        'List open or filtered accounting review items such as missing approvals, amount mismatches, or unclear scope issues.',
      inputSchema: listReviewItemsSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = listReviewItemsSchema.parse(input);
      const result = await workflowRepository.listReviewItems(parsed, user);
      const worksheetData = parsed.syncToWorksheet
        ? reviewItemWorksheetRows(result)
        : null;
      const sheetSync = await syncWorksheetViewIfEnabled(
        sheetsSync,
        user,
        worksheetData
          ? {
              workspaceId: parsed.workspaceId,
              worksheetName: chooseWorksheetName(
                parsed.worksheetName,
                parsed.saveViewName,
                'Review Items',
              ),
              ...worksheetData,
            }
          : null,
      );

      return {
        content: [
          {
            type: 'text',
            text: sheetSync?.ok
              ? `Found ${result.total} matching review items. Synced worksheet ${sheetSync.worksheetName}.`
              : sheetSync?.error
                ? `Found ${result.total} matching review items. Worksheet sync failed: ${sheetSync.error}`
                : `Found ${result.total} matching review items.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: {
          ...result,
          sheetSync,
        },
      };
    },
  );

  server.registerTool(
    'add_expense',
    {
      title: 'Add Expense',
      description:
        'Collect a reimbursement record with claimant, amount, expense date, and description.',
      inputSchema: addExpenseSchema.shape,
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = addExpenseSchema.parse(input);
      const saved = await repository.addExpense(parsed, user.key);
      const syncWarning = await syncExpenseIfEnabled(sheetsSync, saved, user);

      return {
        content: [
          {
            type: 'text',
            text: syncWarning
              ? `Expense saved for ${saved.claimant}: ${saved.amount} ${saved.currency} on ${saved.expenseDate}. Google Sheets sync failed: ${syncWarning}`
              : `Expense saved for ${saved.claimant}: ${saved.amount} ${saved.currency} on ${saved.expenseDate}.`,
          },
          {
            type: 'text',
            text: formatJson(saved),
          },
        ],
        structuredContent: {
          ...saved,
          sheetsSync: {
            ok: !syncWarning,
            error: syncWarning,
          },
        },
      };
    },
  );

  server.registerTool(
    'list_expenses',
    {
      title: 'List Expenses',
      description:
        'List reimbursement details with optional filters by claimant, date range, category, status, or currency.',
      inputSchema: listExpensesSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = listExpensesSchema.parse(input);
      const result = await repository.listExpenses(parsed, user.key);

      return {
        content: [
          {
            type: 'text',
            text: `Found ${result.total} matching expense records.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'cancel_expense',
    {
      title: 'Cancel Expense',
      description:
        'Cancel an existing reimbursement record when the claimant entered incorrect information.',
      inputSchema: cancelExpenseSchema.shape,
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = cancelExpenseSchema.parse(input);
      const cancelled = await repository.cancelExpense(parsed, user.key);
      const syncWarning = await syncExpenseIfEnabled(sheetsSync, cancelled, user);

      return {
        content: [
          {
            type: 'text',
            text: syncWarning
              ? `Expense ${cancelled.id} for ${cancelled.claimant} has been cancelled. Google Sheets sync failed: ${syncWarning}`
              : `Expense ${cancelled.id} for ${cancelled.claimant} has been cancelled.`,
          },
          {
            type: 'text',
            text: formatJson(cancelled),
          },
        ],
        structuredContent: {
          ...cancelled,
          sheetsSync: {
            ok: !syncWarning,
            error: syncWarning,
          },
        },
      };
    },
  );

  server.registerTool(
    'query_expense_summary',
    {
      title: 'Query Expense Summary',
      description:
        'Summarize reimbursement totals grouped by claimant, category, status, currency, day, or month.',
      inputSchema: summarySchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const user = requireMcpUser(mcpUser);
      const parsed = summarySchema.parse(input);
      const result = await repository.summarize(parsed, user.key);

      return {
        content: [
          {
            type: 'text',
            text: `Summary ready: ${result.totals.expenseCount} expenses, total ${result.totals.totalAmount}.`,
          },
          {
            type: 'text',
            text: formatJson(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'get_accounting_usage_guide',
    {
      title: 'Accounting Usage Guide',
      description: 'Explain how to record and query reimbursement data with this MCP server.',
      inputSchema: {
        language: z.enum(['zh', 'en']).default('zh'),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ language }) => {
      const text =
        language === 'zh'
          ? [
              '可用工具：',
              '1. add_expense：新增一笔报销记录。',
              '2. list_expenses：按条件查询明细。',
              '3. cancel_expense：报销人发现填错后可撤销自己的记录。',
              '4. query_expense_summary：按人、类别、月份等维度统计汇总。',
              '5. upsert_accounting_case：创建或更新账务 case。',
              '6. ingest_source_material：保存原始材料与提取结果。',
              '7. upsert_accounting_record：创建或修正结构化账务记录。',
              '8. upsert_reconciliation_link：创建或更新对账关系。',
              '9. list_reconciliation_links：查询对账关系。',
              '10. search_accounting_records：查询结构化账务记录。',
              '11. upsert_review_item：创建或更新异常/待办事项。',
              '12. list_review_items：查询待处理事项。',
              '13. list_saved_views：查看已保存查询视图。',
              '14. run_saved_view：重新执行已保存视图，并可同步到 worksheet。',
              '15. delete_saved_view：删除不再需要的已保存视图。',
              '16. list_google_drive_files：查看当前 Google 用户可访问的 Drive 文件。',
              '17. read_google_drive_file：读取 Google Docs 或文本类 Drive 文件内容。',
              '18. update_google_drive_file：覆盖更新 Google Docs 或文本类 Drive 文件内容。',
              '19. move_google_drive_file：把 Drive 文件移动到指定文件夹。',
              '20. create_google_drive_folder：在 Drive 中创建文件夹。',
              '21. create_google_drive_text_file：仅用于创建 Google Docs 或文本类文件，不要用于 PDF、图片、Office 文档或压缩包。',
              '22. upload_google_drive_file_auto：PDF、图片、Office 文档、压缩包等文件优先使用这个统一上传入口，服务端会自动选择上传策略。',
              '23. upload_google_drive_file：单次上传较小文件。',
              '24. start_google_drive_upload：开始大文件分片上传会话。',
              '25. append_google_drive_upload_chunk：向上传会话追加一个分片。',
              '26. finish_google_drive_upload：完成分片上传并写入 Drive。',
              '27. abort_google_drive_upload：取消分片上传并清理临时文件。',
              '当 Google Sheets 同步启用时，新增和撤销会自动同步到当前 MCP 调用用户的个人 Google Sheets 文件。',
              'Google Drive 文件读取/编辑依赖当前 Google OAuth token 拥有相应 Drive scope。',
              '建议在写入前先向用户确认报销人、金额、日期和内容，再调用 add_expense。',
            ].join('\n')
          : [
              'Available tools:',
              '1. add_expense: save a reimbursement record.',
              '2. list_expenses: fetch detailed expense rows with filters.',
              '3. cancel_expense: let a claimant withdraw a mistaken reimbursement record.',
              '4. query_expense_summary: aggregate totals by claimant, category, month, and more.',
              '5. upsert_accounting_case: create or update an accounting workflow case.',
              '6. ingest_source_material: store source evidence and extracted fields.',
              '7. upsert_accounting_record: create or revise a structured accounting record.',
              '8. upsert_reconciliation_link: create or update a reconciliation relationship.',
              '9. list_reconciliation_links: query reconciliation relationships.',
              '10. search_accounting_records: query structured accounting records.',
              '11. upsert_review_item: create or update an exception or open item.',
              '12. list_review_items: query outstanding review items.',
              '13. list_saved_views: inspect previously saved query views.',
              '14. run_saved_view: rerun a saved view and optionally sync it to a worksheet.',
              '15. delete_saved_view: remove a saved view that is no longer needed.',
              '16. list_google_drive_files: inspect Google Drive files available to the current Google user.',
              '17. read_google_drive_file: read a Google Docs or text-like Drive file.',
              '18. update_google_drive_file: replace the content of a Google Docs or text-like Drive file.',
              '19. move_google_drive_file: move a Drive file into a target folder.',
              '20. create_google_drive_folder: create a Drive folder.',
              '21. create_google_drive_text_file: only for Google Docs or text-like Drive files, not for PDFs, images, Office files, or archives.',
              '22. upload_google_drive_file_auto: preferred unified upload entrypoint for PDFs, images, Office files, archives, and other non-text files; the server chooses the upload strategy automatically.',
              '23. upload_google_drive_file: upload a smaller file in one call.',
              '24. start_google_drive_upload: begin a chunked upload session for a larger file.',
              '25. append_google_drive_upload_chunk: append one chunk to an upload session.',
              '26. finish_google_drive_upload: finalize a chunked upload into Drive.',
              '27. abort_google_drive_upload: cancel a chunked upload and remove temp data.',
              'When Google Sheets sync is enabled, writes and cancellations update the current MCP caller-specific Google Sheets file automatically.',
              'Google Drive file access depends on the current Google OAuth token having sufficient Drive scopes.',
              'Confirm claimant, amount, expense date, and description before calling add_expense.',
            ].join('\n');

      return {
        content: [
          {
            type: 'text',
            text,
          },
        ],
      };
    },
  );

  return server;
}
