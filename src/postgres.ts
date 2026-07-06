import { Pool } from 'pg';

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: connectionString.includes('sslmode=disable') ? false : undefined,
  });
}

export async function initializeDatabase(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id BIGSERIAL PRIMARY KEY,
      claimant TEXT NOT NULL,
      amount_cents BIGINT NOT NULL,
      currency TEXT NOT NULL,
      expense_date DATE NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      submitted_by TEXT,
      notes TEXT,
      cancelled_at TIMESTAMPTZ,
      cancelled_by TEXT,
      cancellation_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_expenses_claimant ON expenses (claimant);
    CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses (expense_date);
    CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses (category);
    CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses (status);
    CREATE INDEX IF NOT EXISTS idx_expenses_currency ON expenses (currency);
  `);
}
