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
  sourceMaterialIds: idArraySchema.optional().default([]),
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
