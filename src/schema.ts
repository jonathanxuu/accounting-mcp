import { z } from 'zod/v4';

export const expenseStatusSchema = z.enum([
  'submitted',
  'approved',
  'reimbursed',
  'rejected',
  'cancelled',
]);

export const expenseCategorySchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .default('general');

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3)
  .max(10)
  .default('CNY');

export const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format');

const jsonObjectSchema = z.record(z.string(), z.unknown()).default({});
const stringArraySchema = z.array(z.string().trim().min(1)).default([]);
const idArraySchema = z.array(z.number().int().positive()).default([]);
const worksheetNameSchema = z.string().trim().min(1).max(100);
const driveFileIdSchema = z.string().trim().min(1).max(255);
const sheetRangeSchema = z.string().trim().min(1).max(200);
const sheetCellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

function parsePositiveIdArrayInput(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

const materialLinkIdsSchema = z.preprocess(
  parsePositiveIdArrayInput,
  z.array(z.number().int().positive()).transform((values) => [...new Set(values)].sort((a, b) => a - b)),
);

export const addExpenseSchema = z.object({
  claimant: z.string().trim().min(1).max(100).describe('The reimbursement claimant name'),
  amount: z.number().positive().max(1_000_000).describe('Expense amount as a decimal number'),
  currency: currencySchema.describe('Currency code like CNY or USD'),
  expenseDate: isoDateSchema.describe('Expense date in YYYY-MM-DD format'),
  description: z.string().trim().min(1).max(500).describe('Expense description'),
  category: expenseCategorySchema.describe('Expense category such as travel, meals, office'),
  status: expenseStatusSchema.default('submitted').describe('Current reimbursement status'),
  submittedBy: z.string().trim().min(1).max(100).optional().describe('Optional operator name'),
  notes: z.string().trim().max(1000).optional().describe('Optional notes for accounting use'),
});

export const cancelExpenseSchema = z.object({
  id: z.number().int().positive().describe('Expense record id to cancel'),
  claimant: z.string().trim().min(1).max(100).describe('Claimant name for ownership verification'),
  cancelledBy: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe('Optional operator name performing the cancellation'),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .default('User requested cancellation')
    .describe('Reason for cancelling the reimbursement'),
});

export const listExpensesSchema = z.object({
  claimant: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().min(1).max(50).optional(),
  status: expenseStatusSchema.optional(),
  currency: z.string().trim().toUpperCase().min(3).max(10).optional(),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
  sortBy: z.enum(['expenseDate', 'createdAt', 'amount']).default('expenseDate'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const summarySchema = z.object({
  claimant: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().min(1).max(50).optional(),
  status: expenseStatusSchema.optional(),
  currency: z.string().trim().toUpperCase().min(3).max(10).optional(),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  groupBy: z.enum(['claimant', 'category', 'status', 'currency', 'day', 'month']).default('claimant'),
});

export const accountingCaseStatusSchema = z.enum([
  'draft',
  'active',
  'ready_for_review',
  'closed',
  'voided',
]);

export const sourceMaterialStatusSchema = z.enum(['ingested', 'processed', 'archived', 'voided']);

export const accountingRecordFamilySchema = z.enum([
  'expense_claim',
  'vendor_bill',
  'customer_invoice',
  'bank_transaction',
  'adjustment_candidate',
]);

export const accountingRecordStatusSchema = z.enum([
  'draft',
  'needs_review',
  'ready_for_review',
  'reviewed',
  'voided',
]);

export const reviewItemStatusSchema = z.enum([
  'open',
  'in_progress',
  'blocked',
  'resolved',
  'voided',
]);

export const reviewItemPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
export const savedViewTypeSchema = z.enum(['search_accounting_records', 'list_review_items']);
export const reconciliationLinkStatusSchema = z.enum([
  'proposed',
  'confirmed',
  'rejected',
  'voided',
]);

export const upsertAccountingCaseSchema = z.object({
  id: z.number().int().positive().optional(),
  workspaceId: z.string().trim().min(1).max(100),
  clientEntityId: z.string().trim().min(1).max(100),
  accountingPeriod: z.string().trim().min(1).max(50),
  serviceScope: z.string().trim().min(1).max(100),
  status: accountingCaseStatusSchema.default('draft'),
  metadata: jsonObjectSchema.optional().default({}),
});

export const ingestSourceMaterialSchema = z.object({
  accountingCaseId: z.number().int().positive(),
  sourceType: z.string().trim().min(1).max(50),
  materialKind: z.string().trim().min(1).max(50),
  fileRef: z.string().trim().min(1).max(500).optional(),
  rawText: z.string().trim().min(1).max(20_000).optional(),
  contentHash: z.string().trim().min(1).max(255).optional(),
  extractedFields: jsonObjectSchema.optional().default({}),
  evidenceRefs: stringArraySchema.optional().default([]),
  confidence: z.number().min(0).max(1).optional(),
  status: sourceMaterialStatusSchema.default('ingested'),
});

export const upsertAccountingRecordSchema = z.object({
  id: z.number().int().positive().optional(),
  accountingCaseId: z.number().int().positive(),
  recordFamily: accountingRecordFamilySchema,
  sourceMaterialIds: materialLinkIdsSchema.optional(),
  counterparty: z.string().trim().min(1).max(200).optional(),
  amount: z.number().positive().max(1_000_000),
  currency: currencySchema,
  recordDate: isoDateSchema,
  documentNo: z.string().trim().min(1).max(100).optional(),
  status: accountingRecordStatusSchema.default('draft'),
  description: z.string().trim().min(1).max(1000).optional(),
  attributes: jsonObjectSchema.optional().default({}),
});

export const searchAccountingRecordsSchema = z.object({
  accountingCaseId: z.number().int().positive().optional(),
  workspaceId: z.string().trim().min(1).max(100).optional(),
  clientEntityId: z.string().trim().min(1).max(100).optional(),
  accountingPeriod: z.string().trim().min(1).max(50).optional(),
  serviceScope: z.string().trim().min(1).max(100).optional(),
  accountingCaseStatus: accountingCaseStatusSchema.optional(),
  recordFamily: accountingRecordFamilySchema.optional(),
  recordFamilies: z.array(accountingRecordFamilySchema).min(1).optional(),
  status: accountingRecordStatusSchema.optional(),
  statuses: z.array(accountingRecordStatusSchema).min(1).optional(),
  counterparty: z.string().trim().min(1).max(200).optional(),
  currency: z.string().trim().toUpperCase().min(3).max(10).optional(),
  minAmount: z.number().positive().max(1_000_000).optional(),
  maxAmount: z.number().positive().max(1_000_000).optional(),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  sourceMaterialId: z.number().int().positive().optional(),
  documentNo: z.string().trim().min(1).max(100).optional(),
  query: z.string().trim().min(1).max(200).optional(),
  saveViewName: z.string().trim().min(1).max(100).optional(),
  syncToWorksheet: z.boolean().default(false),
  worksheetName: worksheetNameSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
  sortBy: z.enum(['recordDate', 'createdAt', 'amount']).default('recordDate'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const upsertReviewItemSchema = z.object({
  id: z.number().int().positive().optional(),
  accountingCaseId: z.number().int().positive(),
  issueType: z.string().trim().min(1).max(100),
  status: reviewItemStatusSchema.default('open'),
  priority: reviewItemPrioritySchema.default('medium'),
  linkedRecordIds: idArraySchema.optional().default([]),
  linkedMaterialIds: idArraySchema.optional().default([]),
  assignee: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().min(1).max(500),
  details: z.string().trim().min(1).max(5000).optional(),
  resolutionNotes: z.string().trim().min(1).max(5000).optional(),
});

export const upsertReconciliationLinkSchema = z.object({
  id: z.number().int().positive().optional(),
  accountingCaseId: z.number().int().positive(),
  sourceRecordId: z.number().int().positive(),
  targetRecordId: z.number().int().positive(),
  matchedAmount: z.number().positive().max(1_000_000),
  currency: currencySchema,
  status: reconciliationLinkStatusSchema.default('proposed'),
  evidenceRefs: stringArraySchema.optional().default([]),
  notes: z.string().trim().min(1).max(5000).optional(),
});

export const listReconciliationLinksSchema = z.object({
  accountingCaseId: z.number().int().positive().optional(),
  sourceRecordId: z.number().int().positive().optional(),
  targetRecordId: z.number().int().positive().optional(),
  status: reconciliationLinkStatusSchema.optional(),
  statuses: z.array(reconciliationLinkStatusSchema).min(1).optional(),
  currency: z.string().trim().toUpperCase().min(3).max(10).optional(),
  minMatchedAmount: z.number().positive().max(1_000_000).optional(),
  maxMatchedAmount: z.number().positive().max(1_000_000).optional(),
  query: z.string().trim().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export const listReviewItemsSchema = z.object({
  accountingCaseId: z.number().int().positive().optional(),
  workspaceId: z.string().trim().min(1).max(100).optional(),
  clientEntityId: z.string().trim().min(1).max(100).optional(),
  accountingPeriod: z.string().trim().min(1).max(50).optional(),
  serviceScope: z.string().trim().min(1).max(100).optional(),
  accountingCaseStatus: accountingCaseStatusSchema.optional(),
  issueType: z.string().trim().min(1).max(100).optional(),
  issueTypes: z.array(z.string().trim().min(1).max(100)).min(1).optional(),
  status: reviewItemStatusSchema.optional(),
  statuses: z.array(reviewItemStatusSchema).min(1).optional(),
  priority: reviewItemPrioritySchema.optional(),
  priorities: z.array(reviewItemPrioritySchema).min(1).optional(),
  assignee: z.string().trim().min(1).max(200).optional(),
  linkedRecordId: z.number().int().positive().optional(),
  linkedMaterialId: z.number().int().positive().optional(),
  unresolvedOnly: z.boolean().default(false),
  query: z.string().trim().min(1).max(200).optional(),
  saveViewName: z.string().trim().min(1).max(100).optional(),
  syncToWorksheet: z.boolean().default(false),
  worksheetName: worksheetNameSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export const listSavedViewsSchema = z.object({
  viewType: savedViewTypeSchema.optional(),
  query: z.string().trim().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export const runSavedViewSchema = z
  .object({
    savedViewId: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(100).optional(),
    syncToWorksheet: z.boolean().default(false),
    worksheetName: worksheetNameSchema.optional(),
  })
  .refine((value) => value.savedViewId || value.name, {
    message: 'Either savedViewId or name is required',
    path: ['savedViewId'],
  });

export const deleteSavedViewSchema = z
  .object({
    savedViewId: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(100).optional(),
  })
  .refine((value) => value.savedViewId || value.name, {
    message: 'Either savedViewId or name is required',
    path: ['savedViewId'],
  });

export const listGoogleDriveFilesSchema = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  folderId: driveFileIdSchema.optional(),
  mimeType: z.string().trim().min(1).max(200).optional(),
  includeTrashed: z.boolean().default(false),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const readGoogleDriveFileSchema = z.object({
  fileId: driveFileIdSchema.describe('Google Drive file id'),
});

export const updateGoogleDriveFileSchema = z.object({
  fileId: driveFileIdSchema.describe('Google Drive file id'),
  content: z.string().max(1_000_000).describe('Replacement file content as plain text'),
});

export const createGoogleDriveFolderSchema = z.object({
  name: z.string().trim().min(1).max(255).describe('Google Drive folder name'),
  parentFolderId: driveFileIdSchema.optional().describe('Optional parent Google Drive folder id'),
});

export const sharedGoogleSheetRoleSchema = z.enum(['editor', 'viewer']);
const googleSpreadsheetUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2000)
  .describe('Google Sheets URL such as https://docs.google.com/spreadsheets/d/.../edit');

export const createSharedGoogleSheetSchema = z.object({
  workspaceId: z.string().trim().min(1).max(100).describe('Workspace id that should share one Google Sheet'),
  title: z.string().trim().min(1).max(255).optional().describe('Optional Google Sheet title'),
  memberEmails: z
    .array(z.string().trim().email().max(320))
    .max(100)
    .optional()
    .describe('Optional additional member email addresses to share immediately'),
});

export const shareSharedGoogleSheetSchema = z
  .object({
    workspaceId: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe('Workspace id for the shared Google Sheet'),
    spreadsheetUrl: googleSpreadsheetUrlSchema.optional(),
    memberEmail: z.string().trim().email().max(320).describe('Email address to grant access to'),
    role: sharedGoogleSheetRoleSchema
      .default('editor')
      .describe('Whether the member can edit or only view the shared sheet'),
  })
  .refine((value) => value.workspaceId || value.spreadsheetUrl, {
    message: 'Either workspaceId or spreadsheetUrl is required',
    path: ['workspaceId'],
  });

export const getSharedGoogleSheetSchema = z
  .object({
    workspaceId: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe('Workspace id for the shared Google Sheet'),
    spreadsheetUrl: googleSpreadsheetUrlSchema.optional(),
  })
  .refine((value) => value.workspaceId || value.spreadsheetUrl, {
    message: 'Either workspaceId or spreadsheetUrl is required',
    path: ['workspaceId'],
  });

export const listSharedGoogleSheetTabsSchema = getSharedGoogleSheetSchema;

export const readSharedGoogleSheetCellsSchema = getSharedGoogleSheetSchema.extend({
  worksheetName: worksheetNameSchema.describe('Worksheet tab name to read from'),
  range: sheetRangeSchema
    .default('A:ZZ')
    .describe('A1 range within the worksheet, such as A1:N50 or A:ZZ'),
});

export const writeGoogleSheetCellsSchema = getSharedGoogleSheetSchema.extend({
  worksheetName: worksheetNameSchema.describe('Worksheet tab name to write to'),
  range: sheetRangeSchema.describe(
    'A1 range within the worksheet. Use a start cell such as A1 for update, or a table range such as A:Z for append.',
  ),
  values: z
    .array(z.array(sheetCellValueSchema).min(1).max(100))
    .min(1)
    .max(500)
    .describe('Two-dimensional rows and cells to write'),
  mode: z
    .enum(['update', 'append'])
    .default('update')
    .describe('update replaces values beginning at the range; append adds rows after existing table data'),
  valueInputOption: z
    .enum(['RAW', 'USER_ENTERED'])
    .default('USER_ENTERED')
    .describe('RAW stores literal values; USER_ENTERED lets Google Sheets interpret formulas, dates, and numbers'),
});

export const createGoogleDriveTextFileSchema = z.object({
  name: z.string().trim().min(1).max(255).describe('Google Drive file name'),
  mimeType: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .describe('Target mime type such as text/plain or application/vnd.google-apps.document'),
  parentFolderId: driveFileIdSchema.optional().describe('Optional parent Google Drive folder id'),
  content: z
    .string()
    .max(1_000_000)
    .optional()
    .describe('Optional plain-text content for Google Docs or text-like files'),
});

export const uploadGoogleDriveFileSchema = z.object({
  name: z.string().trim().min(1).max(255).describe('Google Drive file name'),
  mimeType: z.string().trim().min(1).max(255).describe('Mime type for the uploaded file'),
  parentFolderId: driveFileIdSchema.optional().describe('Optional parent Google Drive folder id'),
  contentBase64: z
    .string()
    .trim()
    .min(1)
    .max(10_000_000)
    .describe('Base64-encoded file content for smaller uploads'),
});

export const uploadGoogleDriveFileAutoSchema = z.object({
  name: z.string().trim().min(1).max(255).describe('Google Drive file name'),
  mimeType: z.string().trim().min(1).max(255).describe('Mime type for the uploaded file'),
  parentFolderId: driveFileIdSchema.optional().describe('Optional parent Google Drive folder id'),
  contentBase64: z
    .string()
    .trim()
    .min(1)
    .max(25_000_000)
    .describe('Base64-encoded file content. The server will choose the upload strategy automatically.'),
});

export const startGoogleDriveUploadSchema = z.object({
  name: z.string().trim().min(1).max(255).describe('Google Drive file name'),
  mimeType: z.string().trim().min(1).max(255).describe('Mime type for the uploaded file'),
  parentFolderId: driveFileIdSchema.optional().describe('Optional parent Google Drive folder id'),
  totalBytes: z
    .number()
    .int()
    .positive()
    .max(1024 * 1024 * 1024)
    .optional()
    .describe('Optional expected total byte size'),
});

export const appendGoogleDriveUploadChunkSchema = z.object({
  uploadId: z.string().trim().min(1).max(255).describe('Upload session id'),
  contentBase64: z
    .string()
    .trim()
    .min(1)
    .max(10_000_000)
    .describe('Base64-encoded chunk content to append to the upload session'),
});

export const finishGoogleDriveUploadSchema = z.object({
  uploadId: z.string().trim().min(1).max(255).describe('Upload session id'),
});

export const abortGoogleDriveUploadSchema = z.object({
  uploadId: z.string().trim().min(1).max(255).describe('Upload session id'),
});

export const moveGoogleDriveFileSchema = z.object({
  fileId: driveFileIdSchema.describe('Google Drive file id to move'),
  destinationFolderId: driveFileIdSchema.describe('Target Google Drive folder id'),
  removeFromPreviousParents: z
    .boolean()
    .default(true)
    .describe('Whether to remove the file from its previous parent folders after moving'),
});

export type AddExpenseInput = z.infer<typeof addExpenseSchema>;
export type CancelExpenseInput = z.infer<typeof cancelExpenseSchema>;
export type ListExpensesInput = z.infer<typeof listExpensesSchema>;
export type SummaryInput = z.infer<typeof summarySchema>;
export type UpsertAccountingCaseInput = z.infer<typeof upsertAccountingCaseSchema>;
export type IngestSourceMaterialInput = z.infer<typeof ingestSourceMaterialSchema>;
export type UpsertAccountingRecordInput = z.infer<typeof upsertAccountingRecordSchema>;
export type SearchAccountingRecordsInput = z.infer<typeof searchAccountingRecordsSchema>;
export type UpsertReviewItemInput = z.infer<typeof upsertReviewItemSchema>;
export type ListReviewItemsInput = z.infer<typeof listReviewItemsSchema>;
export type ListSavedViewsInput = z.infer<typeof listSavedViewsSchema>;
export type RunSavedViewInput = z.infer<typeof runSavedViewSchema>;
export type DeleteSavedViewInput = z.infer<typeof deleteSavedViewSchema>;
export type UpsertReconciliationLinkInput = z.infer<typeof upsertReconciliationLinkSchema>;
export type ListReconciliationLinksInput = z.infer<typeof listReconciliationLinksSchema>;
export type ListGoogleDriveFilesInput = z.infer<typeof listGoogleDriveFilesSchema>;
export type ReadGoogleDriveFileInput = z.infer<typeof readGoogleDriveFileSchema>;
export type UpdateGoogleDriveFileInput = z.infer<typeof updateGoogleDriveFileSchema>;
export type CreateGoogleDriveFolderInput = z.infer<typeof createGoogleDriveFolderSchema>;
export type CreateSharedGoogleSheetInput = z.infer<typeof createSharedGoogleSheetSchema>;
export type ShareSharedGoogleSheetInput = z.infer<typeof shareSharedGoogleSheetSchema>;
export type GetSharedGoogleSheetInput = z.infer<typeof getSharedGoogleSheetSchema>;
export type ListSharedGoogleSheetTabsInput = z.infer<typeof listSharedGoogleSheetTabsSchema>;
export type ReadSharedGoogleSheetCellsInput = z.infer<typeof readSharedGoogleSheetCellsSchema>;
export type WriteGoogleSheetCellsInput = z.infer<typeof writeGoogleSheetCellsSchema>;
export type CreateGoogleDriveTextFileInput = z.infer<typeof createGoogleDriveTextFileSchema>;
export type UploadGoogleDriveFileInput = z.infer<typeof uploadGoogleDriveFileSchema>;
export type UploadGoogleDriveFileAutoInput = z.infer<typeof uploadGoogleDriveFileAutoSchema>;
export type StartGoogleDriveUploadInput = z.infer<typeof startGoogleDriveUploadSchema>;
export type AppendGoogleDriveUploadChunkInput = z.infer<
  typeof appendGoogleDriveUploadChunkSchema
>;
export type FinishGoogleDriveUploadInput = z.infer<typeof finishGoogleDriveUploadSchema>;
export type AbortGoogleDriveUploadInput = z.infer<typeof abortGoogleDriveUploadSchema>;
export type MoveGoogleDriveFileInput = z.infer<typeof moveGoogleDriveFileSchema>;
