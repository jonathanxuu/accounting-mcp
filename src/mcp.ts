import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';

import { ExpenseRepository } from './repository.js';
import { GoogleSheetsSync } from './sheets.js';
import {
  addExpenseSchema,
  cancelExpenseSchema,
  listExpensesSchema,
  summarySchema,
} from './schema.js';

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function syncExpenseIfEnabled(sync: GoogleSheetsSync | null, expense: unknown) {
  if (!sync) {
    return;
  }

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
  );
}

export function createAccountingServer(
  repository: ExpenseRepository,
  sheetsSync: GoogleSheetsSync | null,
) {
  const server = new McpServer({
    name: 'accounting-mcp',
    version: '0.1.0',
  });

  server.registerTool(
    'add_expense',
    {
      title: 'Add Expense',
      description:
        'Collect a reimbursement record with claimant, amount, expense date, and description.',
      inputSchema: addExpenseSchema.shape,
    },
    async (input) => {
      const parsed = addExpenseSchema.parse(input);
      const saved = await repository.addExpense(parsed);
      await syncExpenseIfEnabled(sheetsSync, saved);

      return {
        content: [
          {
            type: 'text',
            text: `Expense saved for ${saved.claimant}: ${saved.amount} ${saved.currency} on ${saved.expenseDate}.`,
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
      const parsed = listExpensesSchema.parse(input);
      const result = await repository.listExpenses(parsed);

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
      const parsed = cancelExpenseSchema.parse(input);
      const cancelled = await repository.cancelExpense(parsed);
      await syncExpenseIfEnabled(sheetsSync, cancelled);

      return {
        content: [
          {
            type: 'text',
            text: `Expense ${cancelled.id} for ${cancelled.claimant} has been cancelled.`,
          },
          {
            type: 'text',
            text: formatJson(cancelled),
          },
        ],
        structuredContent: cancelled,
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
      const parsed = summarySchema.parse(input);
      const result = await repository.summarize(parsed);

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
              '当 Google Sheets 同步启用时，新增和撤销会自动同步到表格。',
              '建议在写入前先向用户确认报销人、金额、日期和内容，再调用 add_expense。',
            ].join('\n')
          : [
              'Available tools:',
              '1. add_expense: save a reimbursement record.',
              '2. list_expenses: fetch detailed expense rows with filters.',
              '3. cancel_expense: let a claimant withdraw a mistaken reimbursement record.',
              '4. query_expense_summary: aggregate totals by claimant, category, month, and more.',
              'When Google Sheets sync is enabled, writes and cancellations update the sheet automatically.',
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
