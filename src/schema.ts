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

export type AddExpenseInput = z.infer<typeof addExpenseSchema>;
export type CancelExpenseInput = z.infer<typeof cancelExpenseSchema>;
export type ListExpensesInput = z.infer<typeof listExpensesSchema>;
export type SummaryInput = z.infer<typeof summarySchema>;
