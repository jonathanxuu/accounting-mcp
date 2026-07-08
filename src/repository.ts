import type { Pool } from 'pg';

import type {
  AddExpenseInput,
  CancelExpenseInput,
  ListExpensesInput,
  SummaryInput,
} from './schema.js';

type ExpenseRow = {
  id: string | number;
  mcp_user_key: string | null;
  claimant: string;
  amount_cents: string | number;
  currency: string;
  expense_date: string;
  description: string;
  category: string;
  status: string;
  submitted_by: string | null;
  notes: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
};

type SummaryRow = {
  group_value: string;
  total_amount_cents: string | number;
  expense_count: string | number;
};

function toAmountCents(amount: number): number {
  return Math.round(amount * 100);
}

function fromExpenseRow(row: ExpenseRow) {
  return {
    id: Number(row.id),
    mcpUserKey: row.mcp_user_key,
    claimant: row.claimant,
    amount: Number(row.amount_cents) / 100,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    expenseDate: row.expense_date,
    description: row.description,
    category: row.category,
    status: row.status,
    submittedBy: row.submitted_by,
    notes: row.notes,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    cancellationReason: row.cancellation_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function appendFilter(
  conditions: string[],
  params: unknown[],
  column: string,
  value: string | undefined,
) {
  if (!value) {
    return;
  }

  params.push(value);
  conditions.push(`${column} = $${params.length}`);
}

function buildWhereClause(filters: {
  mcpUserKey: string;
  claimant?: string;
  category?: string;
  status?: string;
  currency?: string;
  startDate?: string;
  endDate?: string;
}) {
  const conditions: string[] = ['mcp_user_key = $1'];
  const params: unknown[] = [filters.mcpUserKey];

  appendFilter(conditions, params, 'claimant', filters.claimant);
  appendFilter(conditions, params, 'category', filters.category);
  appendFilter(conditions, params, 'status', filters.status);
  appendFilter(conditions, params, 'currency', filters.currency);

  if (filters.startDate) {
    params.push(filters.startDate);
    conditions.push(`expense_date >= $${params.length}`);
  }

  if (filters.endDate) {
    params.push(filters.endDate);
    conditions.push(`expense_date <= $${params.length}`);
  }

  return {
    params,
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
  };
}

function resolveGroupExpression(groupBy: SummaryInput['groupBy']): string {
  switch (groupBy) {
    case 'claimant':
      return 'claimant';
    case 'category':
      return 'category';
    case 'status':
      return 'status';
    case 'currency':
      return 'currency';
    case 'day':
      return 'expense_date';
    case 'month':
      return "substr(expense_date, 1, 7)";
    default:
      return 'claimant';
  }
}

function resolveSortColumn(sortBy: ListExpensesInput['sortBy']): string {
  switch (sortBy) {
    case 'createdAt':
      return 'created_at';
    case 'amount':
      return 'amount_cents';
    case 'expenseDate':
    default:
      return 'expense_date';
  }
}

export class ExpenseRepository {
  constructor(private readonly pool: Pool) {}

  async addExpense(input: AddExpenseInput, mcpUserKey: string) {
    const now = new Date().toISOString();
    const amountCents = toAmountCents(input.amount);
    const result = await this.pool.query<ExpenseRow>(
      `
      INSERT INTO expenses (
        mcp_user_key,
        claimant,
        amount_cents,
        currency,
        expense_date,
        description,
        category,
        status,
        submitted_by,
        notes,
        created_at,
        updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
      `,
      [
        mcpUserKey,
        input.claimant,
        amountCents,
        input.currency,
        input.expenseDate,
        input.description,
        input.category,
        input.status,
        input.submittedBy ?? input.claimant,
        input.notes ?? null,
        now,
        now,
      ],
    );

    return fromExpenseRow(result.rows[0]);
  }

  async cancelExpense(input: CancelExpenseInput, mcpUserKey: string) {
    const existingResult = await this.pool.query<ExpenseRow>(
      'SELECT * FROM expenses WHERE id = $1 AND mcp_user_key = $2',
      [input.id, mcpUserKey],
    );
    const existing = existingResult.rows[0];

    if (!existing) {
      throw new Error(`Expense record ${input.id} was not found`);
    }

    if (existing.claimant !== input.claimant) {
      throw new Error(`Expense record ${input.id} does not belong to claimant ${input.claimant}`);
    }

    if (existing.status === 'cancelled') {
      throw new Error(`Expense record ${input.id} has already been cancelled`);
    }

    if (existing.status === 'reimbursed') {
      throw new Error(
        `Expense record ${input.id} has already been reimbursed and cannot be cancelled`,
      );
    }

    const now = new Date().toISOString();

    const updatedResult = await this.pool.query<ExpenseRow>(
      `
      UPDATE expenses
      SET
        status = 'cancelled',
        cancelled_at = $1,
        cancelled_by = $2,
        cancellation_reason = $3,
        updated_at = $4
      WHERE id = $5
        AND mcp_user_key = $6
      RETURNING *
      `,
      [now, input.cancelledBy ?? input.claimant, input.reason, now, input.id, mcpUserKey],
    );

    return fromExpenseRow(updatedResult.rows[0]);
  }

  async listExpenses(input: ListExpensesInput, mcpUserKey: string) {
    const { whereClause, params } = buildWhereClause({ ...input, mcpUserKey });
    const sortColumn = resolveSortColumn(input.sortBy);
    const sortOrder = input.sortOrder.toUpperCase();
    const paginationParams = [...params, input.limit, input.offset];
    const rowsResult = await this.pool.query<ExpenseRow>(
      `
      SELECT *
      FROM expenses
      ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder}, id DESC
      LIMIT $${paginationParams.length - 1}
      OFFSET $${paginationParams.length}
      `,
      paginationParams,
    );
    const totalResult = await this.pool.query<{ total: string }>(
      `
      SELECT COUNT(*) AS total
      FROM expenses
      ${whereClause}
      `,
      params,
    );

    return {
      items: rowsResult.rows.map(fromExpenseRow),
      limit: input.limit,
      offset: input.offset,
      total: Number(totalResult.rows[0]?.total ?? 0),
    };
  }

  async summarize(input: SummaryInput, mcpUserKey: string) {
    const { whereClause, params } = buildWhereClause({ ...input, mcpUserKey });
    const groupExpression = resolveGroupExpression(input.groupBy);
    const rowsResult = await this.pool.query<SummaryRow>(
      `
      SELECT
        ${groupExpression} AS group_value,
        SUM(amount_cents) AS total_amount_cents,
        COUNT(*) AS expense_count
      FROM expenses
      ${whereClause}
      GROUP BY ${groupExpression}
      ORDER BY total_amount_cents DESC, group_value ASC
      `,
      params,
    );
    const totalsResult = await this.pool.query<{ expense_count: string; total_amount_cents: string }>(
      `
      SELECT
        COUNT(*) AS expense_count,
        COALESCE(SUM(amount_cents), 0) AS total_amount_cents
      FROM expenses
      ${whereClause}
      `,
      params,
    );
    const totals = totalsResult.rows[0];

    return {
      groupBy: input.groupBy,
      filters: {
        claimant: input.claimant ?? null,
        category: input.category ?? null,
        status: input.status ?? null,
        currency: input.currency ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
      },
      totals: {
        expenseCount: Number(totals.expense_count),
        totalAmount: Number(totals.total_amount_cents) / 100,
        totalAmountCents: Number(totals.total_amount_cents),
      },
      groups: rowsResult.rows.map((row) => ({
        group: row.group_value,
        expenseCount: Number(row.expense_count),
        totalAmount: Number(row.total_amount_cents) / 100,
        totalAmountCents: Number(row.total_amount_cents),
      })),
    };
  }
}
