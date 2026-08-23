import type { Pool, PoolClient } from 'pg';

import { memberIdentityForUser, type McpUserIdentity } from './sheetMappings.js';
import type {
  DeleteSavedViewInput,
  IngestSourceMaterialInput,
  ListReconciliationLinksInput,
  ListSavedViewsInput,
  ListReviewItemsInput,
  RunSavedViewInput,
  SearchAccountingRecordsInput,
  UpsertAccountingCaseInput,
  UpsertAccountingRecordInput,
  UpsertReconciliationLinkInput,
  UpsertReviewItemInput,
} from './schema.js';

type Queryable = Pick<Pool | PoolClient, 'query'>;

type AccountingCaseRow = {
  id: string | number;
  owner_user_key: string;
  workspace_id: string;
  client_entity_id: string;
  accounting_period: string;
  service_scope: string;
  status: string;
  metadata_json: Record<string, unknown> | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

type AccountingCaseSummary = ReturnType<typeof fromAccountingCaseRow>;

type SourceMaterialRow = {
  id: string | number;
  accounting_case_id: string | number;
  source_type: string;
  material_kind: string;
  file_ref: string | null;
  raw_text: string | null;
  content_hash: string | null;
  extracted_fields_json: Record<string, unknown> | null;
  evidence_refs_json: unknown[] | null;
  confidence: number | null;
  status: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

type AccountingRecordRow = {
  id: string | number;
  accounting_case_id: string | number;
  record_family: string;
  source_material_ids_json: unknown[] | null;
  counterparty: string | null;
  amount_cents: string | number;
  currency: string;
  record_date: string;
  document_no: string | null;
  status: string;
  description: string | null;
  attributes_json: Record<string, unknown> | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

type AccountingRecordSearchRow = AccountingRecordRow & {
  case_workspace_id: string;
  case_client_entity_id: string;
  case_accounting_period: string;
  case_service_scope: string;
  case_status: string;
};

type ReviewItemRow = {
  id: string | number;
  accounting_case_id: string | number;
  issue_type: string;
  status: string;
  priority: string;
  linked_record_ids_json: unknown[] | null;
  linked_material_ids_json: unknown[] | null;
  assignee: string | null;
  summary: string;
  details: string | null;
  resolution_notes: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

type ReviewItemSearchRow = ReviewItemRow & {
  case_workspace_id: string;
  case_client_entity_id: string;
  case_accounting_period: string;
  case_service_scope: string;
  case_status: string;
};

type ReconciliationLinkRow = {
  id: string | number;
  accounting_case_id: string | number;
  source_record_id: string | number;
  target_record_id: string | number;
  matched_amount_cents: string | number;
  currency: string;
  status: string;
  evidence_refs_json: unknown[] | null;
  notes: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

type ReconciliationLinkSearchRow = ReconciliationLinkRow & {
  source_record_family: string;
  source_counterparty: string | null;
  source_record_date: string;
  target_record_family: string;
  target_counterparty: string | null;
  target_record_date: string;
  case_workspace_id: string;
  case_client_entity_id: string;
  case_accounting_period: string;
  case_service_scope: string;
  case_status: string;
};

type RecordAmountRow = {
  id: string | number;
  amount_cents: string | number;
  currency: string;
  record_family: string;
  counterparty: string | null;
  record_date: string;
};

type BreakdownRow = {
  key: string | null;
  item_count: string | number;
  total_amount_cents?: string | number;
};

type SavedViewRow = {
  id: string | number;
  owner_user_key: string;
  view_type: string;
  name: string;
  worksheet_name: string | null;
  filters_json: Record<string, unknown> | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

type SavedViewType = 'search_accounting_records' | 'list_review_items';

function toAmountCents(amount: number): number {
  return Math.round(amount * 100);
}

function toNumberArray(value: unknown[] | null | undefined): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function toStringArray(value: unknown[] | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item : String(item ?? '')))
    .map((item) => item.trim())
    .filter(Boolean);
}

function fromAccountingCaseRow(row: AccountingCaseRow) {
  return {
    id: Number(row.id),
    ownerUserKey: row.owner_user_key,
    workspaceId: row.workspace_id,
    clientEntityId: row.client_entity_id,
    accountingPeriod: row.accounting_period,
    serviceScope: row.service_scope,
    status: row.status,
    metadata: row.metadata_json ?? {},
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromSourceMaterialRow(row: SourceMaterialRow) {
  return {
    id: Number(row.id),
    accountingCaseId: Number(row.accounting_case_id),
    sourceType: row.source_type,
    materialKind: row.material_kind,
    fileRef: row.file_ref,
    rawText: row.raw_text,
    contentHash: row.content_hash,
    extractedFields: row.extracted_fields_json ?? {},
    evidenceRefs: toStringArray(row.evidence_refs_json),
    confidence: row.confidence,
    status: row.status,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromAccountingRecordRow(row: AccountingRecordRow) {
  return {
    id: Number(row.id),
    accountingCaseId: Number(row.accounting_case_id),
    recordFamily: row.record_family,
    sourceMaterialIds: toNumberArray(row.source_material_ids_json),
    counterparty: row.counterparty,
    amount: Number(row.amount_cents) / 100,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    recordDate: row.record_date,
    documentNo: row.document_no,
    status: row.status,
    description: row.description,
    attributes: row.attributes_json ?? {},
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function caseSummaryFromJoinedRow(row: {
  accounting_case_id: string | number;
  case_workspace_id: string;
  case_client_entity_id: string;
  case_accounting_period: string;
  case_service_scope: string;
  case_status: string;
}) {
  return {
    id: Number(row.accounting_case_id),
    workspaceId: row.case_workspace_id,
    clientEntityId: row.case_client_entity_id,
    accountingPeriod: row.case_accounting_period,
    serviceScope: row.case_service_scope,
    status: row.case_status,
  };
}

function fromAccountingRecordSearchRow(row: AccountingRecordSearchRow) {
  return {
    ...fromAccountingRecordRow(row),
    case: caseSummaryFromJoinedRow(row),
  };
}

function fromReviewItemRow(row: ReviewItemRow) {
  return {
    id: Number(row.id),
    accountingCaseId: Number(row.accounting_case_id),
    issueType: row.issue_type,
    status: row.status,
    priority: row.priority,
    linkedRecordIds: toNumberArray(row.linked_record_ids_json),
    linkedMaterialIds: toNumberArray(row.linked_material_ids_json),
    assignee: row.assignee,
    summary: row.summary,
    details: row.details,
    resolutionNotes: row.resolution_notes,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromReviewItemSearchRow(row: ReviewItemSearchRow) {
  return {
    ...fromReviewItemRow(row),
    case: caseSummaryFromJoinedRow(row),
  };
}

function fromSavedViewRow(row: SavedViewRow) {
  return {
    id: Number(row.id),
    ownerUserKey: row.owner_user_key,
    viewType: row.view_type,
    name: row.name,
    worksheetName: row.worksheet_name,
    filters: row.filters_json ?? {},
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sortUniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function fromReconciliationLinkRow(row: ReconciliationLinkRow) {
  return {
    id: Number(row.id),
    accountingCaseId: Number(row.accounting_case_id),
    sourceRecordId: Number(row.source_record_id),
    targetRecordId: Number(row.target_record_id),
    matchedAmount: Number(row.matched_amount_cents) / 100,
    matchedAmountCents: Number(row.matched_amount_cents),
    currency: row.currency,
    status: row.status,
    evidenceRefs: toStringArray(row.evidence_refs_json),
    notes: row.notes,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromReconciliationLinkSearchRow(row: ReconciliationLinkSearchRow) {
  return {
    ...fromReconciliationLinkRow(row),
    case: caseSummaryFromJoinedRow({
      accounting_case_id: row.accounting_case_id,
      case_workspace_id: row.case_workspace_id,
      case_client_entity_id: row.case_client_entity_id,
      case_accounting_period: row.case_accounting_period,
      case_service_scope: row.case_service_scope,
      case_status: row.case_status,
    }),
    sourceRecord: {
      id: Number(row.source_record_id),
      recordFamily: row.source_record_family,
      counterparty: row.source_counterparty,
      recordDate: row.source_record_date,
    },
    targetRecord: {
      id: Number(row.target_record_id),
      recordFamily: row.target_record_family,
      counterparty: row.target_counterparty,
      recordDate: row.target_record_date,
    },
  };
}

async function insertAuditEvent(
  db: Queryable,
  actor: McpUserIdentity,
  event: {
    accountingCaseId: number | null;
    action: string;
    objectType: string;
    objectId: string;
    diff?: Record<string, unknown>;
    context?: Record<string, unknown>;
  },
) {
  await db.query(
    `
    INSERT INTO audit_events (
      accounting_case_id,
      actor_key,
      actor_label,
      action,
      object_type,
      object_id,
      diff_json,
      context_json,
      created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,
    [
      event.accountingCaseId,
      actor.key,
      actor.label,
      event.action,
      event.objectType,
      event.objectId,
      event.diff ?? {},
      event.context ?? {},
      new Date().toISOString(),
    ],
  );
}

async function ensureOwnedCase(db: Queryable, accountingCaseId: number, actor: McpUserIdentity) {
  const result = await db.query<{ id: string }>(
    `
    SELECT id
    FROM accounting_cases
    WHERE id = $1
      AND (
        owner_user_key = $2
        OR EXISTS (
          SELECT 1
          FROM shared_spreadsheet_members ssm
          WHERE ssm.workspace_id = accounting_cases.workspace_id
            AND (ssm.member_key = $2 OR ssm.member_identity = $3)
        )
      )
    `,
    [accountingCaseId, actor.key, memberIdentityForUser(actor)],
  );

  if (!result.rows[0]) {
    throw new Error(`Accounting case ${accountingCaseId} was not found`);
  }
}

async function ensureOwnedRecordInCase(
  db: Queryable,
  recordId: number,
  accountingCaseId: number,
  actor: McpUserIdentity,
) {
  const result = await db.query<{ id: string }>(
    `
    SELECT ar.id
    FROM accounting_records ar
    INNER JOIN accounting_cases ac
      ON ac.id = ar.accounting_case_id
    WHERE ar.id = $1
      AND ar.accounting_case_id = $2
      AND (
        ac.owner_user_key = $3
        OR EXISTS (
          SELECT 1
          FROM shared_spreadsheet_members ssm
          WHERE ssm.workspace_id = ac.workspace_id
            AND (ssm.member_key = $3 OR ssm.member_identity = $4)
        )
      )
    `,
    [recordId, accountingCaseId, actor.key, memberIdentityForUser(actor)],
  );

  if (!result.rows[0]) {
    throw new Error(
      `Accounting record ${recordId} was not found in accounting case ${accountingCaseId}`,
    );
  }
}

async function fetchOwnedRecordDetails(
  db: Queryable,
  recordId: number,
  accountingCaseId: number,
  actor: McpUserIdentity,
): Promise<RecordAmountRow> {
  const result = await db.query<RecordAmountRow>(
    `
    SELECT ar.id, ar.amount_cents, ar.currency, ar.record_family, ar.counterparty, ar.record_date
    FROM accounting_records ar
    INNER JOIN accounting_cases ac
      ON ac.id = ar.accounting_case_id
    WHERE ar.id = $1
      AND ar.accounting_case_id = $2
      AND (
        ac.owner_user_key = $3
        OR EXISTS (
          SELECT 1
          FROM shared_spreadsheet_members ssm
          WHERE ssm.workspace_id = ac.workspace_id
            AND (ssm.member_key = $3 OR ssm.member_identity = $4)
        )
      )
    `,
    [recordId, accountingCaseId, actor.key, memberIdentityForUser(actor)],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(
      `Accounting record ${recordId} was not found in accounting case ${accountingCaseId}`,
    );
  }

  return row;
}

async function findMatchingOpenReviewItem(
  db: Queryable,
  input: {
    accountingCaseId: number;
    issueType: string;
    summary: string;
  },
): Promise<ReviewItemRow | null> {
  const result = await db.query<ReviewItemRow>(
    `
    SELECT *
    FROM review_items
    WHERE accounting_case_id = $1
      AND issue_type = $2
      AND summary = $3
      AND status IN ('open', 'in_progress', 'blocked')
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [input.accountingCaseId, input.issueType, input.summary],
  );

  return result.rows[0] ?? null;
}

async function upsertSystemReviewItem(
  db: Queryable,
  actor: McpUserIdentity,
  input: {
    accountingCaseId: number;
    issueType: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    linkedRecordIds: number[];
    linkedMaterialIds?: number[];
    summary: string;
    details: string;
  },
) {
  const existing = await findMatchingOpenReviewItem(db, {
    accountingCaseId: input.accountingCaseId,
    issueType: input.issueType,
    summary: input.summary,
  });
  const now = new Date().toISOString();
  const linkedRecordIds = sortUniqueNumbers(input.linkedRecordIds);
  const linkedMaterialIds = sortUniqueNumbers(input.linkedMaterialIds ?? []);

  if (existing) {
    const result = await db.query<ReviewItemRow>(
      `
      UPDATE review_items
      SET
        priority = $1,
        linked_record_ids_json = $2,
        linked_material_ids_json = $3,
        details = $4,
        updated_by = $5,
        updated_at = $6
      WHERE id = $7
      RETURNING *
      `,
      [input.priority, linkedRecordIds, linkedMaterialIds, input.details, actor.label, now, existing.id],
    );

    await insertAuditEvent(db, actor, {
      accountingCaseId: input.accountingCaseId,
      action: 'updated',
      objectType: 'review_item',
      objectId: String(existing.id),
      diff: {
        issueType: input.issueType,
        summary: input.summary,
        source: 'system_reconciliation_check',
      },
    });

    return fromReviewItemRow(result.rows[0]);
  }

  const result = await db.query<ReviewItemRow>(
    `
    INSERT INTO review_items (
      accounting_case_id,
      issue_type,
      status,
      priority,
      linked_record_ids_json,
      linked_material_ids_json,
      assignee,
      summary,
      details,
      resolution_notes,
      created_by,
      updated_by,
      created_at,
      updated_at
    ) VALUES ($1,$2,'open',$3,$4,$5,NULL,$6,$7,NULL,$8,$9,$10,$11)
    RETURNING *
    `,
    [
      input.accountingCaseId,
      input.issueType,
      input.priority,
      linkedRecordIds,
      linkedMaterialIds,
      input.summary,
      input.details,
      actor.label,
      actor.label,
      now,
      now,
    ],
  );

  await insertAuditEvent(db, actor, {
    accountingCaseId: input.accountingCaseId,
    action: 'created',
    objectType: 'review_item',
    objectId: String(result.rows[0].id),
    diff: {
      issueType: input.issueType,
      summary: input.summary,
      source: 'system_reconciliation_check',
    },
  });

  return fromReviewItemRow(result.rows[0]);
}

async function resolveSystemReviewItem(
  db: Queryable,
  actor: McpUserIdentity,
  input: {
    accountingCaseId: number;
    issueType: string;
    summary: string;
  },
) {
  const existing = await findMatchingOpenReviewItem(db, input);
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();
  const result = await db.query<ReviewItemRow>(
    `
    UPDATE review_items
    SET
      status = 'resolved',
      resolution_notes = $1,
      updated_by = $2,
      updated_at = $3
    WHERE id = $4
    RETURNING *
    `,
    ['Automatically resolved after reconciliation state changed', actor.label, now, existing.id],
  );

  await insertAuditEvent(db, actor, {
    accountingCaseId: input.accountingCaseId,
    action: 'updated',
    objectType: 'review_item',
    objectId: String(existing.id),
    diff: {
      status: 'resolved',
      source: 'system_reconciliation_check',
    },
  });

  return fromReviewItemRow(result.rows[0]);
}

async function syncReconciliationReviewItems(
  db: Queryable,
  actor: McpUserIdentity,
  input: {
    accountingCaseId: number;
    sourceRecordId: number;
    targetRecordId: number;
    currentLinkId: number;
    matchedAmountCents: number;
  },
) {
  const sourceRecord = await fetchOwnedRecordDetails(
    db,
    input.sourceRecordId,
    input.accountingCaseId,
    actor,
  );
  const targetRecord = await fetchOwnedRecordDetails(
    db,
    input.targetRecordId,
    input.accountingCaseId,
    actor,
  );

  const amountMismatchSummary = `Reconciliation amount mismatch between records ${input.sourceRecordId} and ${input.targetRecordId}`;
  const amountMismatch =
    Number(sourceRecord.amount_cents) !== input.matchedAmountCents ||
    Number(targetRecord.amount_cents) !== input.matchedAmountCents;

  if (amountMismatch) {
    await upsertSystemReviewItem(db, actor, {
      accountingCaseId: input.accountingCaseId,
      issueType: 'reconciliation_amount_mismatch',
      priority: 'high',
      linkedRecordIds: [input.sourceRecordId, input.targetRecordId],
      summary: amountMismatchSummary,
      details:
        `Matched amount ${input.matchedAmountCents / 100} ${sourceRecord.currency} does not fully align with ` +
        `source record amount ${Number(sourceRecord.amount_cents) / 100} and target record amount ${Number(targetRecord.amount_cents) / 100}.`,
    });
  } else {
    await resolveSystemReviewItem(db, actor, {
      accountingCaseId: input.accountingCaseId,
      issueType: 'reconciliation_amount_mismatch',
      summary: amountMismatchSummary,
    });
  }

  const linkCountResult = await db.query<{ source_count: string; target_count: string }>(
    `
    SELECT
      COUNT(*) FILTER (
        WHERE status IN ('proposed', 'confirmed')
          AND source_record_id = $1
      ) AS source_count,
      COUNT(*) FILTER (
        WHERE status IN ('proposed', 'confirmed')
          AND target_record_id = $2
      ) AS target_count
    FROM reconciliation_links
    WHERE accounting_case_id = $3
    `,
    [input.sourceRecordId, input.targetRecordId, input.accountingCaseId],
  );

  const sourceCount = Number(linkCountResult.rows[0]?.source_count ?? 0);
  const targetCount = Number(linkCountResult.rows[0]?.target_count ?? 0);
  const multiLinkSummary = `Reconciliation multi-link conflict for records ${input.sourceRecordId} and ${input.targetRecordId}`;
  const hasMultiLinkConflict = sourceCount > 1 || targetCount > 1;

  if (hasMultiLinkConflict) {
    await upsertSystemReviewItem(db, actor, {
      accountingCaseId: input.accountingCaseId,
      issueType: 'reconciliation_multi_link_conflict',
      priority: 'medium',
      linkedRecordIds: [input.sourceRecordId, input.targetRecordId],
      summary: multiLinkSummary,
      details:
        `Detected multiple active reconciliation links. Source record active link count: ${sourceCount}. ` +
        `Target record active link count: ${targetCount}.`,
    });
  } else {
    await resolveSystemReviewItem(db, actor, {
      accountingCaseId: input.accountingCaseId,
      issueType: 'reconciliation_multi_link_conflict',
      summary: multiLinkSummary,
    });
  }
}

function appendFilter(
  conditions: string[],
  params: unknown[],
  clause: string,
  value: string | number | undefined,
) {
  if (value === undefined || value === '') {
    return;
  }

  params.push(value);
  conditions.push(`${clause} $${params.length}`);
}

function appendArrayAnyFilter(
  conditions: string[],
  params: unknown[],
  column: string,
  values: string[] | undefined,
) {
  if (!values || values.length === 0) {
    return;
  }

  params.push(values);
  conditions.push(`${column} = ANY($${params.length})`);
}

function appendJsonbContainsNumberFilter(
  conditions: string[],
  params: unknown[],
  column: string,
  value: number | undefined,
) {
  if (!value) {
    return;
  }

  params.push(JSON.stringify([value]));
  conditions.push(`${column} @> $${params.length}::jsonb`);
}

function appendWorkspaceAccessCondition(
  conditions: string[],
  params: unknown[],
  actor: McpUserIdentity,
  caseAlias: string,
) {
  params.push(actor.key);
  const actorKeyParam = params.length;
  params.push(memberIdentityForUser(actor));
  const actorIdentityParam = params.length;
  conditions.push(
    `(${caseAlias}.owner_user_key = $${actorKeyParam} OR EXISTS (` +
      `SELECT 1 FROM shared_spreadsheet_members ssm ` +
      `WHERE ssm.workspace_id = ${caseAlias}.workspace_id ` +
      `AND (ssm.member_key = $${actorKeyParam} OR ssm.member_identity = $${actorIdentityParam})` +
      '))',
  );
}

function buildRecordWhereClause(input: SearchAccountingRecordsInput, actor: McpUserIdentity) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  appendWorkspaceAccessCondition(conditions, params, actor, 'ac');

  appendFilter(conditions, params, 'ar.accounting_case_id =', input.accountingCaseId);
  appendFilter(conditions, params, 'ac.workspace_id =', input.workspaceId);
  appendFilter(conditions, params, 'ac.client_entity_id =', input.clientEntityId);
  appendFilter(conditions, params, 'ac.accounting_period =', input.accountingPeriod);
  appendFilter(conditions, params, 'ac.service_scope =', input.serviceScope);
  appendFilter(conditions, params, 'ac.status =', input.accountingCaseStatus);
  appendFilter(conditions, params, 'ar.record_family =', input.recordFamily);
  appendArrayAnyFilter(conditions, params, 'ar.record_family', input.recordFamilies);
  appendFilter(conditions, params, 'ar.status =', input.status);
  appendArrayAnyFilter(conditions, params, 'ar.status', input.statuses);
  appendFilter(conditions, params, 'ar.counterparty =', input.counterparty);
  appendFilter(conditions, params, 'ar.currency =', input.currency);
  appendFilter(conditions, params, 'ar.document_no =', input.documentNo);
  appendJsonbContainsNumberFilter(
    conditions,
    params,
    'ar.source_material_ids_json',
    input.sourceMaterialId,
  );

  if (input.minAmount !== undefined) {
    params.push(toAmountCents(input.minAmount));
    conditions.push(`ar.amount_cents >= $${params.length}`);
  }

  if (input.maxAmount !== undefined) {
    params.push(toAmountCents(input.maxAmount));
    conditions.push(`ar.amount_cents <= $${params.length}`);
  }

  if (input.startDate) {
    params.push(input.startDate);
    conditions.push(`ar.record_date >= $${params.length}`);
  }

  if (input.endDate) {
    params.push(input.endDate);
    conditions.push(`ar.record_date <= $${params.length}`);
  }

  if (input.query) {
    params.push(`%${input.query}%`);
    conditions.push(
      `(COALESCE(ar.counterparty, '') ILIKE $${params.length} OR COALESCE(ar.document_no, '') ILIKE $${params.length} OR COALESCE(ar.description, '') ILIKE $${params.length})`,
    );
  }

  return {
    params,
    whereClause: `WHERE ${conditions.join(' AND ')}`,
  };
}

function buildReviewWhereClause(input: ListReviewItemsInput, actor: McpUserIdentity) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  appendWorkspaceAccessCondition(conditions, params, actor, 'ac');

  appendFilter(conditions, params, 'ri.accounting_case_id =', input.accountingCaseId);
  appendFilter(conditions, params, 'ac.workspace_id =', input.workspaceId);
  appendFilter(conditions, params, 'ac.client_entity_id =', input.clientEntityId);
  appendFilter(conditions, params, 'ac.accounting_period =', input.accountingPeriod);
  appendFilter(conditions, params, 'ac.service_scope =', input.serviceScope);
  appendFilter(conditions, params, 'ac.status =', input.accountingCaseStatus);
  appendFilter(conditions, params, 'ri.issue_type =', input.issueType);
  appendArrayAnyFilter(conditions, params, 'ri.issue_type', input.issueTypes);
  appendFilter(conditions, params, 'ri.status =', input.status);
  appendArrayAnyFilter(conditions, params, 'ri.status', input.statuses);
  appendFilter(conditions, params, 'ri.priority =', input.priority);
  appendArrayAnyFilter(conditions, params, 'ri.priority', input.priorities);
  appendFilter(conditions, params, 'ri.assignee =', input.assignee);
  appendJsonbContainsNumberFilter(
    conditions,
    params,
    'ri.linked_record_ids_json',
    input.linkedRecordId,
  );
  appendJsonbContainsNumberFilter(
    conditions,
    params,
    'ri.linked_material_ids_json',
    input.linkedMaterialId,
  );

  if (input.unresolvedOnly) {
    params.push(['open', 'in_progress', 'blocked']);
    conditions.push(`ri.status = ANY($${params.length})`);
  }

  if (input.query) {
    params.push(`%${input.query}%`);
    conditions.push(
      `(ri.summary ILIKE $${params.length} OR COALESCE(ri.details, '') ILIKE $${params.length} OR COALESCE(ri.resolution_notes, '') ILIKE $${params.length})`,
    );
  }

  return {
    params,
    whereClause: `WHERE ${conditions.join(' AND ')}`,
  };
}

export class WorkflowRepository {
  constructor(private readonly pool: Pool) {}

  async upsertAccountingCase(input: UpsertAccountingCaseInput, actor: McpUserIdentity) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      let row: AccountingCaseRow;
      const now = new Date().toISOString();

      if (input.id) {
        const result = await client.query<AccountingCaseRow>(
          `
          UPDATE accounting_cases
          SET
            workspace_id = $1,
            client_entity_id = $2,
            accounting_period = $3,
            service_scope = $4,
            status = $5,
            metadata_json = $6,
            updated_by = $7,
            updated_at = $8
          WHERE id = $9
            AND owner_user_key = $10
          RETURNING *
          `,
          [
            input.workspaceId,
            input.clientEntityId,
            input.accountingPeriod,
            input.serviceScope,
            input.status,
            input.metadata,
            actor.label,
            now,
            input.id,
            actor.key,
          ],
        );

        row = result.rows[0];
        if (!row) {
          throw new Error(`Accounting case ${input.id} was not found`);
        }

        await insertAuditEvent(client, actor, {
          accountingCaseId: Number(row.id),
          action: 'updated',
          objectType: 'accounting_case',
          objectId: String(row.id),
          diff: input,
        });
      } else {
        const result = await client.query<AccountingCaseRow>(
          `
          INSERT INTO accounting_cases (
            owner_user_key,
            workspace_id,
            client_entity_id,
            accounting_period,
            service_scope,
            status,
            metadata_json,
            created_by,
            updated_by,
            created_at,
            updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          RETURNING *
          `,
          [
            actor.key,
            input.workspaceId,
            input.clientEntityId,
            input.accountingPeriod,
            input.serviceScope,
            input.status,
            input.metadata,
            actor.label,
            actor.label,
            now,
            now,
          ],
        );

        row = result.rows[0];

        await insertAuditEvent(client, actor, {
          accountingCaseId: Number(row.id),
          action: 'created',
          objectType: 'accounting_case',
          objectId: String(row.id),
          diff: input,
        });
      }

      await client.query('COMMIT');
      return fromAccountingCaseRow(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ingestSourceMaterial(input: IngestSourceMaterialInput, actor: McpUserIdentity) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await ensureOwnedCase(client, input.accountingCaseId, actor);

      const now = new Date().toISOString();
      const result = await client.query<SourceMaterialRow>(
        `
        INSERT INTO source_materials (
          accounting_case_id,
          source_type,
          material_kind,
          file_ref,
          raw_text,
          content_hash,
          extracted_fields_json,
          evidence_refs_json,
          confidence,
          status,
          created_by,
          updated_by,
          created_at,
          updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING *
        `,
        [
          input.accountingCaseId,
          input.sourceType,
          input.materialKind,
          input.fileRef ?? null,
          input.rawText ?? null,
          input.contentHash ?? null,
          input.extractedFields,
          input.evidenceRefs,
          input.confidence ?? null,
          input.status,
          actor.label,
          actor.label,
          now,
          now,
        ],
      );

      const row = result.rows[0];

      await insertAuditEvent(client, actor, {
        accountingCaseId: input.accountingCaseId,
        action: 'created',
        objectType: 'source_material',
        objectId: String(row.id),
        diff: input,
      });

      await client.query('COMMIT');
      return fromSourceMaterialRow(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertAccountingRecord(input: UpsertAccountingRecordInput, actor: McpUserIdentity) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await ensureOwnedCase(client, input.accountingCaseId, actor);

      const now = new Date().toISOString();
      const amountCents = toAmountCents(input.amount);
      let row: AccountingRecordRow;

      if (input.id) {
        const result = await client.query<AccountingRecordRow>(
          `
          UPDATE accounting_records ar
          SET
            accounting_case_id = $1,
            record_family = $2,
            source_material_ids_json = $3,
            counterparty = $4,
            amount_cents = $5,
            currency = $6,
            record_date = $7,
            document_no = $8,
            status = $9,
            description = $10,
            attributes_json = $11,
            updated_by = $12,
            updated_at = $13
          FROM accounting_cases ac
          WHERE ar.id = $14
            AND ac.id = ar.accounting_case_id
            AND (
              ac.owner_user_key = $15
              OR EXISTS (
                SELECT 1
                FROM shared_spreadsheet_members ssm
                WHERE ssm.workspace_id = ac.workspace_id
                  AND (ssm.member_key = $15 OR ssm.member_identity = $16)
              )
            )
          RETURNING ar.*
          `,
          [
            input.accountingCaseId,
            input.recordFamily,
            input.sourceMaterialIds,
            input.counterparty ?? null,
            amountCents,
            input.currency,
            input.recordDate,
            input.documentNo ?? null,
            input.status,
            input.description ?? null,
            input.attributes,
            actor.label,
            now,
            input.id,
            actor.key,
            memberIdentityForUser(actor),
          ],
        );

        row = result.rows[0];
        if (!row) {
          throw new Error(`Accounting record ${input.id} was not found`);
        }

        await insertAuditEvent(client, actor, {
          accountingCaseId: Number(row.accounting_case_id),
          action: 'updated',
          objectType: 'accounting_record',
          objectId: String(row.id),
          diff: input,
        });
      } else {
        const result = await client.query<AccountingRecordRow>(
          `
          INSERT INTO accounting_records (
            accounting_case_id,
            record_family,
            source_material_ids_json,
            counterparty,
            amount_cents,
            currency,
            record_date,
            document_no,
            status,
            description,
            attributes_json,
            created_by,
            updated_by,
            created_at,
            updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
          RETURNING *
          `,
          [
            input.accountingCaseId,
            input.recordFamily,
            input.sourceMaterialIds,
            input.counterparty ?? null,
            amountCents,
            input.currency,
            input.recordDate,
            input.documentNo ?? null,
            input.status,
            input.description ?? null,
            input.attributes,
            actor.label,
            actor.label,
            now,
            now,
          ],
        );

        row = result.rows[0];

        await insertAuditEvent(client, actor, {
          accountingCaseId: input.accountingCaseId,
          action: 'created',
          objectType: 'accounting_record',
          objectId: String(row.id),
          diff: input,
        });
      }

      await client.query('COMMIT');
      return fromAccountingRecordRow(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async searchAccountingRecords(input: SearchAccountingRecordsInput, actor: McpUserIdentity) {
    const { whereClause, params } = buildRecordWhereClause(input, actor);

    const sortColumn =
      input.sortBy === 'createdAt'
        ? 'ar.created_at'
        : input.sortBy === 'amount'
          ? 'ar.amount_cents'
          : 'ar.record_date';
    const sortOrder = input.sortOrder.toUpperCase();
    const paginationParams = [...params, input.limit, input.offset];

    const rowsResult = await this.pool.query<AccountingRecordSearchRow>(
      `
      SELECT
        ar.*,
        ac.workspace_id AS case_workspace_id,
        ac.client_entity_id AS case_client_entity_id,
        ac.accounting_period AS case_accounting_period,
        ac.service_scope AS case_service_scope,
        ac.status AS case_status
      FROM accounting_records ar
      INNER JOIN accounting_cases ac
        ON ac.id = ar.accounting_case_id
      ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder}, ar.id DESC
      LIMIT $${paginationParams.length - 1}
      OFFSET $${paginationParams.length}
      `,
      paginationParams,
    );

    const totalsResult = await this.pool.query<{ total: string; total_amount_cents: string }>(
      `
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(ar.amount_cents), 0) AS total_amount_cents
      FROM accounting_records ar
      INNER JOIN accounting_cases ac
        ON ac.id = ar.accounting_case_id
      ${whereClause}
      `,
      params,
    );

    const totalResult = await this.pool.query<{ total: string }>(
      `
      SELECT COUNT(*) AS total
      FROM accounting_records ar
      INNER JOIN accounting_cases ac
        ON ac.id = ar.accounting_case_id
      ${whereClause}
      `,
      params,
    );

    const byFamilyResult = await this.pool.query<BreakdownRow>(
      `
      SELECT
        ar.record_family AS key,
        COUNT(*) AS item_count,
        COALESCE(SUM(ar.amount_cents), 0) AS total_amount_cents
      FROM accounting_records ar
      INNER JOIN accounting_cases ac
        ON ac.id = ar.accounting_case_id
      ${whereClause}
      GROUP BY ar.record_family
      ORDER BY total_amount_cents DESC, key ASC
      `,
      params,
    );

    const byStatusResult = await this.pool.query<BreakdownRow>(
      `
      SELECT
        ar.status AS key,
        COUNT(*) AS item_count,
        COALESCE(SUM(ar.amount_cents), 0) AS total_amount_cents
      FROM accounting_records ar
      INNER JOIN accounting_cases ac
        ON ac.id = ar.accounting_case_id
      ${whereClause}
      GROUP BY ar.status
      ORDER BY item_count DESC, key ASC
      `,
      params,
    );

    const byCurrencyResult = await this.pool.query<BreakdownRow>(
      `
      SELECT
        ar.currency AS key,
        COUNT(*) AS item_count,
        COALESCE(SUM(ar.amount_cents), 0) AS total_amount_cents
      FROM accounting_records ar
      INNER JOIN accounting_cases ac
        ON ac.id = ar.accounting_case_id
      ${whereClause}
      GROUP BY ar.currency
      ORDER BY item_count DESC, key ASC
      `,
      params,
    );

    const byCaseResult = await this.pool.query<
      BreakdownRow & {
        accounting_case_id: string | number;
        workspace_id: string;
        client_entity_id: string;
        accounting_period: string;
        service_scope: string;
        case_status: string;
      }
    >(
      `
      SELECT
        ar.accounting_case_id,
        ac.workspace_id,
        ac.client_entity_id,
        ac.accounting_period,
        ac.service_scope,
        ac.status AS case_status,
        CAST(ar.accounting_case_id AS TEXT) AS key,
        COUNT(*) AS item_count,
        COALESCE(SUM(ar.amount_cents), 0) AS total_amount_cents
      FROM accounting_records ar
      INNER JOIN accounting_cases ac
        ON ac.id = ar.accounting_case_id
      ${whereClause}
      GROUP BY
        ar.accounting_case_id,
        ac.workspace_id,
        ac.client_entity_id,
        ac.accounting_period,
        ac.service_scope,
        ac.status
      ORDER BY total_amount_cents DESC, ar.accounting_case_id ASC
      `,
      params,
    );

    const result = {
      filters: {
        accountingCaseId: input.accountingCaseId ?? null,
        workspaceId: input.workspaceId ?? null,
        clientEntityId: input.clientEntityId ?? null,
        accountingPeriod: input.accountingPeriod ?? null,
        serviceScope: input.serviceScope ?? null,
        accountingCaseStatus: input.accountingCaseStatus ?? null,
        recordFamily: input.recordFamily ?? null,
        recordFamilies: input.recordFamilies ?? [],
        status: input.status ?? null,
        statuses: input.statuses ?? [],
        counterparty: input.counterparty ?? null,
        currency: input.currency ?? null,
        minAmount: input.minAmount ?? null,
        maxAmount: input.maxAmount ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        sourceMaterialId: input.sourceMaterialId ?? null,
        documentNo: input.documentNo ?? null,
        query: input.query ?? null,
        saveViewName: input.saveViewName ?? null,
        syncToWorksheet: input.syncToWorksheet,
        worksheetName: input.worksheetName ?? null,
      },
      paging: {
        limit: input.limit,
        offset: input.offset,
      },
      totals: {
        recordCount: Number(totalResult.rows[0]?.total ?? 0),
        totalAmount: Number(totalsResult.rows[0]?.total_amount_cents ?? 0) / 100,
        totalAmountCents: Number(totalsResult.rows[0]?.total_amount_cents ?? 0),
      },
      breakdowns: {
        byRecordFamily: byFamilyResult.rows.map((row) => ({
          recordFamily: row.key,
          count: Number(row.item_count),
          totalAmount: Number(row.total_amount_cents ?? 0) / 100,
          totalAmountCents: Number(row.total_amount_cents ?? 0),
        })),
        byStatus: byStatusResult.rows.map((row) => ({
          status: row.key,
          count: Number(row.item_count),
          totalAmount: Number(row.total_amount_cents ?? 0) / 100,
          totalAmountCents: Number(row.total_amount_cents ?? 0),
        })),
        byCurrency: byCurrencyResult.rows.map((row) => ({
          currency: row.key,
          count: Number(row.item_count),
          totalAmount: Number(row.total_amount_cents ?? 0) / 100,
          totalAmountCents: Number(row.total_amount_cents ?? 0),
        })),
        byCase: byCaseResult.rows.map((row) => ({
          case: {
            id: Number(row.accounting_case_id),
            workspaceId: row.workspace_id,
            clientEntityId: row.client_entity_id,
            accountingPeriod: row.accounting_period,
            serviceScope: row.service_scope,
            status: row.case_status,
          },
          count: Number(row.item_count),
          totalAmount: Number(row.total_amount_cents ?? 0) / 100,
          totalAmountCents: Number(row.total_amount_cents ?? 0),
        })),
      },
      items: rowsResult.rows.map(fromAccountingRecordSearchRow),
    };

    const savedView = input.saveViewName
      ? await this.saveView(
          {
            viewType: 'search_accounting_records',
            name: input.saveViewName,
            worksheetName: input.worksheetName ?? null,
            filters: result.filters,
          },
          actor,
        )
      : null;

    return {
      ...result,
      savedView,
    };
  }

  async upsertReviewItem(input: UpsertReviewItemInput, actor: McpUserIdentity) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await ensureOwnedCase(client, input.accountingCaseId, actor);

      const now = new Date().toISOString();
      let row: ReviewItemRow;

      if (input.id) {
        const result = await client.query<ReviewItemRow>(
          `
          UPDATE review_items ri
          SET
            accounting_case_id = $1,
            issue_type = $2,
            status = $3,
            priority = $4,
            linked_record_ids_json = $5,
            linked_material_ids_json = $6,
            assignee = $7,
            summary = $8,
            details = $9,
            resolution_notes = $10,
            updated_by = $11,
            updated_at = $12
          FROM accounting_cases ac
          WHERE ri.id = $13
            AND ac.id = ri.accounting_case_id
            AND (
              ac.owner_user_key = $14
              OR EXISTS (
                SELECT 1
                FROM shared_spreadsheet_members ssm
                WHERE ssm.workspace_id = ac.workspace_id
                  AND (ssm.member_key = $14 OR ssm.member_identity = $15)
              )
            )
          RETURNING ri.*
          `,
          [
            input.accountingCaseId,
            input.issueType,
            input.status,
            input.priority,
            input.linkedRecordIds,
            input.linkedMaterialIds,
            input.assignee ?? null,
            input.summary,
            input.details ?? null,
            input.resolutionNotes ?? null,
            actor.label,
            now,
            input.id,
            actor.key,
            memberIdentityForUser(actor),
          ],
        );

        row = result.rows[0];
        if (!row) {
          throw new Error(`Review item ${input.id} was not found`);
        }

        await insertAuditEvent(client, actor, {
          accountingCaseId: Number(row.accounting_case_id),
          action: 'updated',
          objectType: 'review_item',
          objectId: String(row.id),
          diff: input,
        });
      } else {
        const result = await client.query<ReviewItemRow>(
          `
          INSERT INTO review_items (
            accounting_case_id,
            issue_type,
            status,
            priority,
            linked_record_ids_json,
            linked_material_ids_json,
            assignee,
            summary,
            details,
            resolution_notes,
            created_by,
            updated_by,
            created_at,
            updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          RETURNING *
          `,
          [
            input.accountingCaseId,
            input.issueType,
            input.status,
            input.priority,
            input.linkedRecordIds,
            input.linkedMaterialIds,
            input.assignee ?? null,
            input.summary,
            input.details ?? null,
            input.resolutionNotes ?? null,
            actor.label,
            actor.label,
            now,
            now,
          ],
        );

        row = result.rows[0];

        await insertAuditEvent(client, actor, {
          accountingCaseId: input.accountingCaseId,
          action: 'created',
          objectType: 'review_item',
          objectId: String(row.id),
          diff: input,
        });
      }

      await client.query('COMMIT');
      return fromReviewItemRow(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listReviewItems(input: ListReviewItemsInput, actor: McpUserIdentity) {
    const { whereClause, params } = buildReviewWhereClause(input, actor);
    const paginationParams = [...params, input.limit, input.offset];

    const rowsResult = await this.pool.query<ReviewItemSearchRow>(
      `
      SELECT
        ri.*,
        ac.workspace_id AS case_workspace_id,
        ac.client_entity_id AS case_client_entity_id,
        ac.accounting_period AS case_accounting_period,
        ac.service_scope AS case_service_scope,
        ac.status AS case_status
      FROM review_items ri
      INNER JOIN accounting_cases ac
        ON ac.id = ri.accounting_case_id
      ${whereClause}
      ORDER BY ri.updated_at DESC, ri.id DESC
      LIMIT $${paginationParams.length - 1}
      OFFSET $${paginationParams.length}
      `,
      paginationParams,
    );

    const totalsResult = await this.pool.query<{ total: string }>(
      `
      SELECT COUNT(*) AS total
      FROM review_items ri
      INNER JOIN accounting_cases ac
        ON ac.id = ri.accounting_case_id
      ${whereClause}
      `,
      params,
    );

    const totalResult = await this.pool.query<{ total: string }>(
      `
      SELECT COUNT(*) AS total
      FROM review_items ri
      INNER JOIN accounting_cases ac
        ON ac.id = ri.accounting_case_id
      ${whereClause}
      `,
      params,
    );

    const byStatusResult = await this.pool.query<BreakdownRow>(
      `
      SELECT
        ri.status AS key,
        COUNT(*) AS item_count
      FROM review_items ri
      INNER JOIN accounting_cases ac
        ON ac.id = ri.accounting_case_id
      ${whereClause}
      GROUP BY ri.status
      ORDER BY item_count DESC, key ASC
      `,
      params,
    );

    const byPriorityResult = await this.pool.query<BreakdownRow>(
      `
      SELECT
        ri.priority AS key,
        COUNT(*) AS item_count
      FROM review_items ri
      INNER JOIN accounting_cases ac
        ON ac.id = ri.accounting_case_id
      ${whereClause}
      GROUP BY ri.priority
      ORDER BY item_count DESC, key ASC
      `,
      params,
    );

    const byIssueTypeResult = await this.pool.query<BreakdownRow>(
      `
      SELECT
        ri.issue_type AS key,
        COUNT(*) AS item_count
      FROM review_items ri
      INNER JOIN accounting_cases ac
        ON ac.id = ri.accounting_case_id
      ${whereClause}
      GROUP BY ri.issue_type
      ORDER BY item_count DESC, key ASC
      `,
      params,
    );

    const byCaseResult = await this.pool.query<
      BreakdownRow & {
        accounting_case_id: string | number;
        workspace_id: string;
        client_entity_id: string;
        accounting_period: string;
        service_scope: string;
        case_status: string;
      }
    >(
      `
      SELECT
        ri.accounting_case_id,
        ac.workspace_id,
        ac.client_entity_id,
        ac.accounting_period,
        ac.service_scope,
        ac.status AS case_status,
        CAST(ri.accounting_case_id AS TEXT) AS key,
        COUNT(*) AS item_count
      FROM review_items ri
      INNER JOIN accounting_cases ac
        ON ac.id = ri.accounting_case_id
      ${whereClause}
      GROUP BY
        ri.accounting_case_id,
        ac.workspace_id,
        ac.client_entity_id,
        ac.accounting_period,
        ac.service_scope,
        ac.status
      ORDER BY item_count DESC, ri.accounting_case_id ASC
      `,
      params,
    );

    const result = {
      filters: {
        accountingCaseId: input.accountingCaseId ?? null,
        workspaceId: input.workspaceId ?? null,
        clientEntityId: input.clientEntityId ?? null,
        accountingPeriod: input.accountingPeriod ?? null,
        serviceScope: input.serviceScope ?? null,
        accountingCaseStatus: input.accountingCaseStatus ?? null,
        issueType: input.issueType ?? null,
        issueTypes: input.issueTypes ?? [],
        status: input.status ?? null,
        statuses: input.statuses ?? [],
        priority: input.priority ?? null,
        priorities: input.priorities ?? [],
        assignee: input.assignee ?? null,
        linkedRecordId: input.linkedRecordId ?? null,
        linkedMaterialId: input.linkedMaterialId ?? null,
        unresolvedOnly: input.unresolvedOnly,
        query: input.query ?? null,
        saveViewName: input.saveViewName ?? null,
        syncToWorksheet: input.syncToWorksheet,
        worksheetName: input.worksheetName ?? null,
      },
      paging: {
        limit: input.limit,
        offset: input.offset,
      },
      totals: {
        reviewItemCount: Number(totalsResult.rows[0]?.total ?? 0),
      },
      breakdowns: {
        byStatus: byStatusResult.rows.map((row) => ({
          status: row.key,
          count: Number(row.item_count),
        })),
        byPriority: byPriorityResult.rows.map((row) => ({
          priority: row.key,
          count: Number(row.item_count),
        })),
        byIssueType: byIssueTypeResult.rows.map((row) => ({
          issueType: row.key,
          count: Number(row.item_count),
        })),
        byCase: byCaseResult.rows.map((row) => ({
          case: {
            id: Number(row.accounting_case_id),
            workspaceId: row.workspace_id,
            clientEntityId: row.client_entity_id,
            accountingPeriod: row.accounting_period,
            serviceScope: row.service_scope,
            status: row.case_status,
          },
          count: Number(row.item_count),
        })),
      },
      items: rowsResult.rows.map(fromReviewItemSearchRow),
      total: Number(totalResult.rows[0]?.total ?? 0),
    };

    const savedView = input.saveViewName
      ? await this.saveView(
          {
            viewType: 'list_review_items',
            name: input.saveViewName,
            worksheetName: input.worksheetName ?? null,
            filters: result.filters,
          },
          actor,
        )
      : null;

    return {
      ...result,
      savedView,
    };
  }

  async upsertReconciliationLink(input: UpsertReconciliationLinkInput, actor: McpUserIdentity) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await ensureOwnedCase(client, input.accountingCaseId, actor);
      await ensureOwnedRecordInCase(client, input.sourceRecordId, input.accountingCaseId, actor);
      await ensureOwnedRecordInCase(client, input.targetRecordId, input.accountingCaseId, actor);

      if (input.sourceRecordId === input.targetRecordId) {
        throw new Error('sourceRecordId and targetRecordId must be different records');
      }

      const now = new Date().toISOString();
      const matchedAmountCents = toAmountCents(input.matchedAmount);
      let row: ReconciliationLinkRow;

      if (input.id) {
        const result = await client.query<ReconciliationLinkRow>(
          `
          UPDATE reconciliation_links rl
          SET
            accounting_case_id = $1,
            source_record_id = $2,
            target_record_id = $3,
            matched_amount_cents = $4,
            currency = $5,
            status = $6,
            evidence_refs_json = $7,
            notes = $8,
            updated_by = $9,
            updated_at = $10
          FROM accounting_cases ac
          WHERE rl.id = $11
            AND ac.id = rl.accounting_case_id
            AND (
              ac.owner_user_key = $12
              OR EXISTS (
                SELECT 1
                FROM shared_spreadsheet_members ssm
                WHERE ssm.workspace_id = ac.workspace_id
                  AND (ssm.member_key = $12 OR ssm.member_identity = $13)
              )
            )
          RETURNING rl.*
          `,
          [
            input.accountingCaseId,
            input.sourceRecordId,
            input.targetRecordId,
            matchedAmountCents,
            input.currency,
            input.status,
            input.evidenceRefs,
            input.notes ?? null,
            actor.label,
            now,
            input.id,
            actor.key,
            memberIdentityForUser(actor),
          ],
        );

        row = result.rows[0];
        if (!row) {
          throw new Error(`Reconciliation link ${input.id} was not found`);
        }

        await insertAuditEvent(client, actor, {
          accountingCaseId: input.accountingCaseId,
          action: 'updated',
          objectType: 'reconciliation_link',
          objectId: String(row.id),
          diff: input,
        });
      } else {
        const result = await client.query<ReconciliationLinkRow>(
          `
          INSERT INTO reconciliation_links (
            accounting_case_id,
            source_record_id,
            target_record_id,
            matched_amount_cents,
            currency,
            status,
            evidence_refs_json,
            notes,
            created_by,
            updated_by,
            created_at,
            updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          RETURNING *
          `,
          [
            input.accountingCaseId,
            input.sourceRecordId,
            input.targetRecordId,
            matchedAmountCents,
            input.currency,
            input.status,
            input.evidenceRefs,
            input.notes ?? null,
            actor.label,
            actor.label,
            now,
            now,
          ],
        );

        row = result.rows[0];

        await insertAuditEvent(client, actor, {
          accountingCaseId: input.accountingCaseId,
          action: 'created',
          objectType: 'reconciliation_link',
          objectId: String(row.id),
          diff: input,
        });
      }

      await syncReconciliationReviewItems(client, actor, {
        accountingCaseId: input.accountingCaseId,
        sourceRecordId: input.sourceRecordId,
        targetRecordId: input.targetRecordId,
        currentLinkId: Number(row.id),
        matchedAmountCents,
      });

      await client.query('COMMIT');
      return fromReconciliationLinkRow(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listReconciliationLinks(input: ListReconciliationLinksInput, actor: McpUserIdentity) {
    const conditions: string[] = [];
    const params: unknown[] = [];

    appendWorkspaceAccessCondition(conditions, params, actor, 'ac');

    appendFilter(conditions, params, 'rl.accounting_case_id =', input.accountingCaseId);
    appendFilter(conditions, params, 'rl.source_record_id =', input.sourceRecordId);
    appendFilter(conditions, params, 'rl.target_record_id =', input.targetRecordId);
    appendFilter(conditions, params, 'rl.status =', input.status);
    appendArrayAnyFilter(conditions, params, 'rl.status', input.statuses);
    appendFilter(conditions, params, 'rl.currency =', input.currency);

    if (input.minMatchedAmount !== undefined) {
      params.push(toAmountCents(input.minMatchedAmount));
      conditions.push(`rl.matched_amount_cents >= $${params.length}`);
    }

    if (input.maxMatchedAmount !== undefined) {
      params.push(toAmountCents(input.maxMatchedAmount));
      conditions.push(`rl.matched_amount_cents <= $${params.length}`);
    }

    if (input.query) {
      params.push(`%${input.query}%`);
      conditions.push(
        `(COALESCE(rl.notes, '') ILIKE $${params.length} OR COALESCE(src.counterparty, '') ILIKE $${params.length} OR COALESCE(tgt.counterparty, '') ILIKE $${params.length})`,
      );
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const paginationParams = [...params, input.limit, input.offset];

    const rowsResult = await this.pool.query<ReconciliationLinkSearchRow>(
      `
      SELECT
        rl.*,
        src.record_family AS source_record_family,
        src.counterparty AS source_counterparty,
        src.record_date AS source_record_date,
        tgt.record_family AS target_record_family,
        tgt.counterparty AS target_counterparty,
        tgt.record_date AS target_record_date,
        ac.workspace_id AS case_workspace_id,
        ac.client_entity_id AS case_client_entity_id,
        ac.accounting_period AS case_accounting_period,
        ac.service_scope AS case_service_scope,
        ac.status AS case_status
      FROM reconciliation_links rl
      INNER JOIN accounting_cases ac
        ON ac.id = rl.accounting_case_id
      INNER JOIN accounting_records src
        ON src.id = rl.source_record_id
      INNER JOIN accounting_records tgt
        ON tgt.id = rl.target_record_id
      ${whereClause}
      ORDER BY rl.updated_at DESC, rl.id DESC
      LIMIT $${paginationParams.length - 1}
      OFFSET $${paginationParams.length}
      `,
      paginationParams,
    );

    const totalResult = await this.pool.query<{ total: string; total_amount_cents: string }>(
      `
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(rl.matched_amount_cents), 0) AS total_amount_cents
      FROM reconciliation_links rl
      INNER JOIN accounting_cases ac
        ON ac.id = rl.accounting_case_id
      INNER JOIN accounting_records src
        ON src.id = rl.source_record_id
      INNER JOIN accounting_records tgt
        ON tgt.id = rl.target_record_id
      ${whereClause}
      `,
      params,
    );

    const byStatusResult = await this.pool.query<BreakdownRow>(
      `
      SELECT
        rl.status AS key,
        COUNT(*) AS item_count,
        COALESCE(SUM(rl.matched_amount_cents), 0) AS total_amount_cents
      FROM reconciliation_links rl
      INNER JOIN accounting_cases ac
        ON ac.id = rl.accounting_case_id
      INNER JOIN accounting_records src
        ON src.id = rl.source_record_id
      INNER JOIN accounting_records tgt
        ON tgt.id = rl.target_record_id
      ${whereClause}
      GROUP BY rl.status
      ORDER BY item_count DESC, key ASC
      `,
      params,
    );

    return {
      filters: {
        accountingCaseId: input.accountingCaseId ?? null,
        sourceRecordId: input.sourceRecordId ?? null,
        targetRecordId: input.targetRecordId ?? null,
        status: input.status ?? null,
        statuses: input.statuses ?? [],
        currency: input.currency ?? null,
        minMatchedAmount: input.minMatchedAmount ?? null,
        maxMatchedAmount: input.maxMatchedAmount ?? null,
        query: input.query ?? null,
      },
      paging: {
        limit: input.limit,
        offset: input.offset,
      },
      totals: {
        linkCount: Number(totalResult.rows[0]?.total ?? 0),
        totalMatchedAmount: Number(totalResult.rows[0]?.total_amount_cents ?? 0) / 100,
        totalMatchedAmountCents: Number(totalResult.rows[0]?.total_amount_cents ?? 0),
      },
      breakdowns: {
        byStatus: byStatusResult.rows.map((row) => ({
          status: row.key,
          count: Number(row.item_count),
          totalMatchedAmount: Number(row.total_amount_cents ?? 0) / 100,
          totalMatchedAmountCents: Number(row.total_amount_cents ?? 0),
        })),
      },
      items: rowsResult.rows.map(fromReconciliationLinkSearchRow),
    };
  }

  async getAccountingCase(accountingCaseId: number, actor: McpUserIdentity) {
    const result = await this.pool.query<AccountingCaseRow>(
      `
      SELECT *
      FROM accounting_cases
      WHERE id = $1
        AND (
          owner_user_key = $2
          OR EXISTS (
            SELECT 1
            FROM shared_spreadsheet_members ssm
            WHERE ssm.workspace_id = accounting_cases.workspace_id
              AND (ssm.member_key = $2 OR ssm.member_identity = $3)
          )
        )
      LIMIT 1
      `,
      [accountingCaseId, actor.key, memberIdentityForUser(actor)],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error(`Accounting case ${accountingCaseId} was not found`);
    }

    return fromAccountingCaseRow(row);
  }

  async listSavedViews(input: ListSavedViewsInput, actor: McpUserIdentity) {
    const conditions = ['owner_user_key = $1'];
    const params: unknown[] = [actor.key];

    appendFilter(conditions, params, 'view_type =', input.viewType);

    if (input.query) {
      params.push(`%${input.query}%`);
      conditions.push(`(name ILIKE $${params.length} OR COALESCE(worksheet_name, '') ILIKE $${params.length})`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const paginationParams = [...params, input.limit, input.offset];

    const rowsResult = await this.pool.query<SavedViewRow>(
      `
      SELECT *
      FROM saved_views
      ${whereClause}
      ORDER BY updated_at DESC, id DESC
      LIMIT $${paginationParams.length - 1}
      OFFSET $${paginationParams.length}
      `,
      paginationParams,
    );

    const totalResult = await this.pool.query<{ total: string }>(
      `
      SELECT COUNT(*) AS total
      FROM saved_views
      ${whereClause}
      `,
      params,
    );

    return {
      filters: {
        viewType: input.viewType ?? null,
        query: input.query ?? null,
      },
      paging: {
        limit: input.limit,
        offset: input.offset,
      },
      total: Number(totalResult.rows[0]?.total ?? 0),
      items: rowsResult.rows.map(fromSavedViewRow),
    };
  }

  async getSavedView(
    input: Pick<RunSavedViewInput, 'savedViewId' | 'name'>,
    actor: McpUserIdentity,
  ) {
    const result = await this.pool.query<SavedViewRow>(
      `
      SELECT *
      FROM saved_views
      WHERE owner_user_key = $1
        AND ($2::bigint IS NULL OR id = $2)
        AND ($3::text IS NULL OR name = $3)
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
      `,
      [actor.key, input.savedViewId ?? null, input.name ?? null],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error(
        input.savedViewId
          ? `Saved view ${input.savedViewId} was not found`
          : `Saved view ${input.name} was not found`,
      );
    }

    return fromSavedViewRow(row) as ReturnType<typeof fromSavedViewRow> & {
      viewType: SavedViewType;
    };
  }

  async deleteSavedView(input: DeleteSavedViewInput, actor: McpUserIdentity) {
    const existing = await this.getSavedView(
      {
        savedViewId: input.savedViewId,
        name: input.name,
      },
      actor,
    );

    const result = await this.pool.query(
      `
      DELETE FROM saved_views
      WHERE owner_user_key = $1
        AND id = $2
      `,
      [actor.key, existing.id],
    );

    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`Saved view ${existing.id} was not found`);
    }

    await insertAuditEvent(this.pool, actor, {
      accountingCaseId: null,
      action: 'saved_view_deleted',
      objectType: 'saved_view',
      objectId: String(existing.id),
      diff: {
        savedViewId: existing.id,
        name: existing.name,
        viewType: existing.viewType,
      },
      context: {
        worksheetName: existing.worksheetName,
      },
    });

    return {
      deleted: true,
      savedView: existing,
    };
  }

  private async saveView(
    input: {
      viewType: string;
      name: string;
      worksheetName: string | null;
      filters: Record<string, unknown>;
    },
    actor: McpUserIdentity,
  ) {
    const now = new Date().toISOString();
    const result = await this.pool.query<SavedViewRow>(
      `
      INSERT INTO saved_views (
        owner_user_key,
        view_type,
        name,
        worksheet_name,
        filters_json,
        created_by,
        updated_by,
        created_at,
        updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (owner_user_key, view_type, name)
      DO UPDATE SET
        worksheet_name = EXCLUDED.worksheet_name,
        filters_json = EXCLUDED.filters_json,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at
      RETURNING *
      `,
      [
        actor.key,
        input.viewType,
        input.name,
        input.worksheetName,
        input.filters,
        actor.label,
        actor.label,
        now,
        now,
      ],
    );

    const row = result.rows[0];

    await insertAuditEvent(this.pool, actor, {
      accountingCaseId: null,
      action: 'saved_view_upserted',
      objectType: 'saved_view',
      objectId: String(row.id),
      diff: {
        viewType: input.viewType,
        name: input.name,
        worksheetName: input.worksheetName,
      },
      context: {
        filters: input.filters,
      },
    });

    return fromSavedViewRow(row);
  }
}
