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

    ALTER TABLE expenses
      ADD COLUMN IF NOT EXISTS mcp_user_key TEXT;

    CREATE INDEX IF NOT EXISTS idx_expenses_mcp_user_key ON expenses (mcp_user_key);

    CREATE TABLE IF NOT EXISTS mcp_user_spreadsheets (
      user_key TEXT PRIMARY KEY,
      user_label TEXT NOT NULL,
      spreadsheet_id TEXT,
      spreadsheet_url TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready',
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE mcp_user_spreadsheets
      ALTER COLUMN spreadsheet_id DROP NOT NULL;

    ALTER TABLE mcp_user_spreadsheets
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready',
      ADD COLUMN IF NOT EXISTS last_error TEXT;

    CREATE TABLE IF NOT EXISTS accounting_cases (
      id BIGSERIAL PRIMARY KEY,
      owner_user_key TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      client_entity_id TEXT NOT NULL,
      accounting_period TEXT NOT NULL,
      service_scope TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_accounting_cases_owner_user_key
      ON accounting_cases (owner_user_key);
    CREATE INDEX IF NOT EXISTS idx_accounting_cases_workspace_id
      ON accounting_cases (workspace_id);
    CREATE INDEX IF NOT EXISTS idx_accounting_cases_client_entity_id
      ON accounting_cases (client_entity_id);
    CREATE INDEX IF NOT EXISTS idx_accounting_cases_status
      ON accounting_cases (status);

    CREATE TABLE IF NOT EXISTS source_materials (
      id BIGSERIAL PRIMARY KEY,
      accounting_case_id BIGINT NOT NULL REFERENCES accounting_cases(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      material_kind TEXT NOT NULL,
      file_ref TEXT,
      raw_text TEXT,
      content_hash TEXT,
      extracted_fields_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      evidence_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      confidence DOUBLE PRECISION,
      status TEXT NOT NULL DEFAULT 'ingested',
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_source_materials_accounting_case_id
      ON source_materials (accounting_case_id);
    CREATE INDEX IF NOT EXISTS idx_source_materials_source_type
      ON source_materials (source_type);
    CREATE INDEX IF NOT EXISTS idx_source_materials_material_kind
      ON source_materials (material_kind);
    CREATE INDEX IF NOT EXISTS idx_source_materials_status
      ON source_materials (status);

    CREATE TABLE IF NOT EXISTS accounting_records (
      id BIGSERIAL PRIMARY KEY,
      accounting_case_id BIGINT NOT NULL REFERENCES accounting_cases(id) ON DELETE CASCADE,
      record_family TEXT NOT NULL,
      source_material_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      counterparty TEXT,
      amount_cents BIGINT NOT NULL,
      currency TEXT NOT NULL,
      record_date DATE NOT NULL,
      document_no TEXT,
      status TEXT NOT NULL,
      description TEXT,
      attributes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_accounting_records_accounting_case_id
      ON accounting_records (accounting_case_id);
    CREATE INDEX IF NOT EXISTS idx_accounting_records_record_family
      ON accounting_records (record_family);
    CREATE INDEX IF NOT EXISTS idx_accounting_records_status
      ON accounting_records (status);
    CREATE INDEX IF NOT EXISTS idx_accounting_records_currency
      ON accounting_records (currency);
    CREATE INDEX IF NOT EXISTS idx_accounting_records_record_date
      ON accounting_records (record_date);
    CREATE INDEX IF NOT EXISTS idx_accounting_records_document_no
      ON accounting_records (document_no);

    CREATE TABLE IF NOT EXISTS review_items (
      id BIGSERIAL PRIMARY KEY,
      accounting_case_id BIGINT NOT NULL REFERENCES accounting_cases(id) ON DELETE CASCADE,
      issue_type TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      linked_record_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      linked_material_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      assignee TEXT,
      summary TEXT NOT NULL,
      details TEXT,
      resolution_notes TEXT,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_review_items_accounting_case_id
      ON review_items (accounting_case_id);
    CREATE INDEX IF NOT EXISTS idx_review_items_issue_type
      ON review_items (issue_type);
    CREATE INDEX IF NOT EXISTS idx_review_items_status
      ON review_items (status);
    CREATE INDEX IF NOT EXISTS idx_review_items_priority
      ON review_items (priority);
    CREATE INDEX IF NOT EXISTS idx_review_items_assignee
      ON review_items (assignee);

    CREATE TABLE IF NOT EXISTS reconciliation_links (
      id BIGSERIAL PRIMARY KEY,
      accounting_case_id BIGINT NOT NULL REFERENCES accounting_cases(id) ON DELETE CASCADE,
      source_record_id BIGINT NOT NULL REFERENCES accounting_records(id) ON DELETE CASCADE,
      target_record_id BIGINT NOT NULL REFERENCES accounting_records(id) ON DELETE CASCADE,
      matched_amount_cents BIGINT NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      evidence_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      notes TEXT,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_reconciliation_links_accounting_case_id
      ON reconciliation_links (accounting_case_id);
    CREATE INDEX IF NOT EXISTS idx_reconciliation_links_source_record_id
      ON reconciliation_links (source_record_id);
    CREATE INDEX IF NOT EXISTS idx_reconciliation_links_target_record_id
      ON reconciliation_links (target_record_id);
    CREATE INDEX IF NOT EXISTS idx_reconciliation_links_status
      ON reconciliation_links (status);

    CREATE TABLE IF NOT EXISTS audit_events (
      id BIGSERIAL PRIMARY KEY,
      accounting_case_id BIGINT REFERENCES accounting_cases(id) ON DELETE CASCADE,
      actor_key TEXT NOT NULL,
      actor_label TEXT NOT NULL,
      action TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      diff_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_audit_events_accounting_case_id
      ON audit_events (accounting_case_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_actor_key
      ON audit_events (actor_key);
    CREATE INDEX IF NOT EXISTS idx_audit_events_object_type_object_id
      ON audit_events (object_type, object_id);

    CREATE TABLE IF NOT EXISTS saved_views (
      id BIGSERIAL PRIMARY KEY,
      owner_user_key TEXT NOT NULL,
      view_type TEXT NOT NULL,
      name TEXT NOT NULL,
      worksheet_name TEXT,
      filters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (owner_user_key, view_type, name)
    );

    CREATE INDEX IF NOT EXISTS idx_saved_views_owner_user_key
      ON saved_views (owner_user_key);
    CREATE INDEX IF NOT EXISTS idx_saved_views_view_type
      ON saved_views (view_type);
  `);
}
