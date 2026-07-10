# Accounting Workflow V2 Design

## Goal

Upgrade `accounting-mcp` from a reimbursement-only MCP server into a lightweight accounting workflow MCP that still keeps:

- PostgreSQL / Cloud SQL as the source of truth
- Google OAuth as the user authorization mechanism
- Google Sheets as the collaboration and visibility layer

This design is based on the July 8 PDF feedback and the current `dev` branch capabilities.

## Guiding Principles

1. Cloud SQL remains the canonical data store.
2. Google Sheets is a synchronized workspace view, not the primary database.
3. Google OAuth continues to identify users and authorize access to Google resources.
4. Existing expense tools stay available during migration.
5. New workflow objects are introduced as additive tables and MCP tools.

## Current Base

The current `dev` branch already supports:

- MCP over HTTP
- PostgreSQL-backed persistence
- Google OAuth bearer-token validation
- optional per-user spreadsheet creation and sync
- expense collection, listing, cancellation, and summary
- spreadsheet mapping persistence

That means V2 is an extension, not a rewrite.

## Target Domain Model

### 1. `accounting_cases`

Container for a group of accounting work under the same client, entity, period, or service scope.

Suggested fields:

- `id`
- `workspace_id`
- `client_entity_id`
- `accounting_period`
- `service_scope`
- `status`
- `metadata_json`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

Suggested status values:

- `draft`
- `active`
- `ready_for_review`
- `closed`
- `voided`

### 2. `source_materials`

Stores original evidence and extracted metadata from uploads or pasted content.

Suggested fields:

- `id`
- `accounting_case_id`
- `source_type`
- `material_kind`
- `file_ref`
- `raw_text`
- `content_hash`
- `extracted_fields_json`
- `evidence_refs_json`
- `confidence`
- `status`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

Examples of `material_kind`:

- `receipt`
- `invoice`
- `bill`
- `bank_statement`
- `remittance_advice`
- `approval`
- `contract`
- `po`
- `payment_screenshot`
- `chat_message`

### 3. `accounting_records`

Normalized structured accounting objects extracted from source materials.

Suggested fields:

- `id`
- `accounting_case_id`
- `record_family`
- `source_material_ids_json`
- `counterparty`
- `amount_cents`
- `currency`
- `record_date`
- `document_no`
- `status`
- `description`
- `attributes_json`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

Supported initial `record_family` values:

- `expense_claim`
- `vendor_bill`
- `customer_invoice`
- `bank_transaction`
- `adjustment_candidate`

Suggested status values:

- `draft`
- `needs_review`
- `ready_for_review`
- `reviewed`
- `voided`

### 4. `reconciliation_links`

Represents matching and reconciliation relationships between records.

Suggested fields:

- `id`
- `accounting_case_id`
- `source_record_id`
- `target_record_id`
- `matched_amount_cents`
- `currency`
- `status`
- `evidence_refs_json`
- `notes`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

Suggested status values:

- `proposed`
- `confirmed`
- `rejected`
- `voided`

### 5. `review_items`

Captures open items, exceptions, and unresolved accounting questions.

Suggested fields:

- `id`
- `accounting_case_id`
- `issue_type`
- `status`
- `priority`
- `linked_record_ids_json`
- `linked_material_ids_json`
- `assignee`
- `summary`
- `details`
- `resolution_notes`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

Examples of `issue_type`:

- `missing_business_purpose`
- `missing_approval`
- `missing_bank_statement`
- `amount_mismatch`
- `suspected_duplicate`
- `unknown_receipt`
- `payment_reversed`
- `unclear_scope`

Suggested status values:

- `open`
- `in_progress`
- `blocked`
- `resolved`
- `voided`

### 6. `handoff_packets`

Snapshot package for another accountant, reviewer, or finance owner.

Suggested fields:

- `id`
- `accounting_case_id`
- `included_record_ids_json`
- `included_review_item_ids_json`
- `summary`
- `snapshot_json`
- `status`
- `created_by`
- `created_at`
- `updated_at`

Suggested status values:

- `draft`
- `generated`
- `superseded`

### 7. `audit_events`

Internal append-only action log for accountability and timeline reconstruction.

Suggested fields:

- `id`
- `accounting_case_id`
- `actor_key`
- `actor_label`
- `action`
- `object_type`
- `object_id`
- `diff_json`
- `context_json`
- `created_at`

Examples of `action`:

- `created`
- `updated`
- `confirmed`
- `rejected`
- `voided`
- `generated`
- `linked`
- `synced_to_sheet`

## Google Sheets Model

## Role of Sheets

Google Sheets should remain a synchronized working surface for humans, not the only copy of business data.

That means:

- Cloud SQL stores complete state and history.
- Sheets exposes filtered or denormalized views.
- Sheets can be regenerated from Cloud SQL if needed.

## Mapping Strategy

The existing `mcp_user_spreadsheets` table in `dev` is a good base, but V2 should generalize it into case-oriented mappings.

Suggested new table: `sheet_mappings`

Suggested fields:

- `id`
- `accounting_case_id`
- `owner_user_key`
- `spreadsheet_id`
- `spreadsheet_url`
- `worksheet_name`
- `view_type`
- `record_family`
- `status`
- `last_synced_at`
- `last_error`
- `created_by`
- `created_at`
- `updated_at`

Examples of `view_type`:

- `case_overview`
- `expense_claims`
- `vendor_bills`
- `customer_invoices`
- `bank_transactions`
- `review_items`
- `handoff_summary`

## Spreadsheet Layout Options

V2 should support both patterns:

1. one spreadsheet per user or per case, with multiple worksheets
2. one shared spreadsheet, with one worksheet per case/view

Recommended V2 default:

- one spreadsheet per case owner or workspace flow
- multiple worksheets by view type

Example worksheets:

- `Overview`
- `Expenses`
- `Vendor Bills`
- `Customer Invoices`
- `Bank Transactions`
- `Review Items`
- `Handoff Summary`

## Google OAuth Model

The current `dev` branch already validates Google access tokens and supports:

- allowed client id restrictions
- allowed email allowlist
- allowed domain allowlist

V2 should keep this structure and extend usage in three directions:

1. authenticate the MCP caller
2. decide which case or spreadsheet they can access
3. optionally use the user's Google token to create or update Sheets in their own Drive

## Recommended Auth Modes

### Mode A: service-account Sheets sync

- Google OAuth identifies the user
- service account writes to a shared spreadsheet
- simpler for centralized finance workflows

### Mode B: user-owned Sheets sync

- Google OAuth identifies the user
- the user's Google token creates and updates a spreadsheet in their Drive
- better for personal or per-operator workspaces

Recommended approach:

- keep supporting both
- make the mapping decide whether a case uses service-account or user-owned sync

## MCP Tool Design

## New V2 Tools

### `upsert_accounting_case`

Create or update a workflow container.

Core input:

- `id` optional
- `workspaceId`
- `clientEntityId`
- `accountingPeriod`
- `serviceScope`
- `status`
- `metadata`

### `ingest_source_material`

Save raw material and extracted metadata.

Core input:

- `accountingCaseId`
- `sourceType`
- `materialKind`
- `fileRef`
- `rawText`
- `contentHash`
- `extractedFields`
- `evidenceRefs`
- `confidence`

### `upsert_accounting_record`

Create or revise a structured accounting record.

Core input:

- `id` optional
- `accountingCaseId`
- `recordFamily`
- `sourceMaterialIds`
- `counterparty`
- `amount`
- `currency`
- `recordDate`
- `documentNo`
- `status`
- `description`
- `attributes`

### `search_accounting_records`

Query records across cases, families, dates, status, and counterparties.

Core filters:

- `accountingCaseId`
- `recordFamily`
- `status`
- `counterparty`
- `currency`
- `startDate`
- `endDate`
- `documentNo`
- `limit`
- `offset`
- `sortBy`
- `sortOrder`

### `upsert_reconciliation_link`

Create, confirm, reject, or update a reconciliation link.

Core input:

- `id` optional
- `accountingCaseId`
- `sourceRecordId`
- `targetRecordId`
- `matchedAmount`
- `currency`
- `status`
- `evidenceRefs`
- `notes`

### `upsert_review_item`

Create or update an open issue or exception.

Core input:

- `id` optional
- `accountingCaseId`
- `issueType`
- `status`
- `priority`
- `linkedRecordIds`
- `linkedMaterialIds`
- `assignee`
- `summary`
- `details`
- `resolutionNotes`

### `list_review_items`

Read-only listing for unresolved or filtered review items.

Core filters:

- `accountingCaseId`
- `issueType`
- `status`
- `priority`
- `assignee`
- `limit`
- `offset`

### `create_handoff_packet`

Generate a handoff snapshot from current case state.

Core input:

- `accountingCaseId`
- `includedRecordIds`
- `includedReviewItemIds`
- `summary`

## Existing Tool Compatibility

Existing reimbursement tools should stay temporarily:

- `add_expense`
- `list_expenses`
- `cancel_expense`
- `query_expense_summary`

Compatibility strategy:

- keep current tools operational
- persist them into both the legacy expense shape and the new `accounting_records` shape, or
- reimplement them as thin adapters over `record_family = expense_claim`

Recommended end state:

- legacy tools become wrappers over the V2 accounting record layer

## Audit Strategy

Every write-like action should automatically append an `audit_events` row.

That includes:

- case create or update
- source material ingest
- record create or update
- review item create or update
- reconciliation confirmation or rejection
- handoff packet generation
- sheet sync operations

This should be service-generated, not user-supplied.

## Sync Strategy

V2 sync should be asynchronous in design, even if initially implemented inline.

Recommended behavior:

1. write canonical object to Cloud SQL
2. write audit event
3. attempt relevant Sheets sync
4. record sync success or failure

Important rule:

- a Sheets failure must not roll back the canonical database write

That is especially important because the current product direction uses Sheets as a convenience layer, not the system of record.

## Implementation Phases

### Phase 1: foundation

- add new V2 tables
- add repository methods
- add Zod schemas for new objects
- add audit event writing
- keep existing expense tools untouched

### Phase 2: MCP workflow tools

- implement `upsert_accounting_case`
- implement `ingest_source_material`
- implement `upsert_accounting_record`
- implement `search_accounting_records`
- implement `upsert_review_item`
- implement `list_review_items`

### Phase 3: reconciliation and handoff

- implement `upsert_reconciliation_link`
- implement `create_handoff_packet`
- add summary generation logic

### Phase 4: Sheets views

- generalize spreadsheet mapping
- sync case-based worksheets
- sync record-family views
- sync review-item and handoff views

### Phase 5: expense migration

- adapt `add_expense` to V2 record model
- adapt `list_expenses` to V2 record model
- adapt `cancel_expense` to V2 status model
- keep old tool names for compatibility

## Recommended First Code Changes

The best first implementation step is:

1. add V2 tables in `postgres.ts`
2. add a new `workflowRepository.ts` or expand `repository.ts`
3. add `audit_events` writing helpers
4. add MCP schemas and handlers for:
   - `upsert_accounting_case`
   - `ingest_source_material`
   - `upsert_accounting_record`
   - `search_accounting_records`
   - `upsert_review_item`
   - `list_review_items`

This gives a useful vertical slice without blocking on reconciliation or handoff generation.

## Open Decisions

These still need explicit product decisions before full implementation:

1. whether spreadsheets are primarily per-user, per-case, or shared by workspace
2. whether each case gets one spreadsheet or one worksheet within a shared spreadsheet
3. whether source files themselves must be uploaded and stored, or only referenced
4. whether one MCP caller may edit all cases in a workspace or only assigned ones
5. whether legacy expense rows need backfill migration into the new V2 tables

## Recommendation

Proceed with V2 on top of the current `dev` branch foundation, keeping Google Cloud, Google OAuth, and Google Sheets.

The recommended architecture is:

- `accounting-mcp` as the workflow API and MCP layer
- `Cloud SQL` as the source of truth
- `Google OAuth` for user identity and delegated Google access
- `Google Sheets` for collaborative working views

This fits both the current codebase and the new accounting workflow scope.
