# accounting-mcp

An HTTP MCP server for reimbursement collection and reporting with PostgreSQL/Cloud SQL storage and optional Google Sheets sync.

## Features

- `add_expense`: save reimbursement records
- `list_expenses`: query detailed rows with filters
- `cancel_expense`: let the claimant cancel an incorrect reimbursement record
- `query_expense_summary`: aggregate totals by claimant, category, status, currency, day, or month
- `get_accounting_usage_guide`: short usage guide for the agent
- Optional real-time sync of expense detail rows into MCP caller-specific Google Sheets files
- Workspace shared Google Sheets for multi-user accounting collaboration
- Google Drive folder creation, file upload, and file move tools for OAuth users

## Stack

- Node.js + TypeScript
- MCP TypeScript SDK with Streamable HTTP transport
- PostgreSQL via `pg`
- Google Sheets API via `googleapis`

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Set environment variables:

```bash
cp .env.example .env
```

3. Start the server:

```bash
npm run dev
```

4. Health check:

```bash
curl http://localhost:4010/health
```

5. Example MCP calls:

```bash
curl -s -X POST http://localhost:4010/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer $ACCOUNTING_MCP_API_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "add_expense",
      "arguments": {
        "claimant": "张三",
        "amount": 86,
        "currency": "CNY",
        "expenseDate": "2026-07-02",
        "description": "打车",
        "category": "交通"
      }
    }
  }'
```

## MCP Endpoint

- URL: `http://localhost:4010/mcp`
- Transport: `streamable-http`
- Auth: `Authorization: Bearer <ACCOUNTING_MCP_API_KEY>`

## Data Storage

Set `DATABASE_URL` to your PostgreSQL or Cloud SQL connection string.

Examples:

```text
postgresql://postgres:password@127.0.0.1:5432/accounting
postgresql://postgres:password@10.0.0.5:5432/accounting
```

For Cloud SQL on an existing server, the usual pattern is:

1. Run Cloud SQL Auth Proxy on the server
2. Point `DATABASE_URL` at the local proxy port

Example:

```text
postgresql://postgres:password@127.0.0.1:5432/accounting
```

The app auto-creates the `expenses` table and indexes at startup.

## Google Sheets Sync

When `GOOGLE_SHEETS_SYNC_ENABLED=true`, each `add_expense` and `cancel_expense` call updates a Google Sheets file owned by the current MCP caller identity in near real time.

### Shared workspace sheet mode

For accounting workflow collaboration, the server can also maintain one shared Google Sheet per `workspaceId`.

Recommended flow:

1. Accountant A signs in with Google OAuth.
2. Accountant A calls `create_shared_google_sheet` for a workspace such as `acme-cn-2026-07`.
3. Accountant A calls `share_shared_google_sheet` to add client B or another accountant by email.
4. Client B signs in with their own Google OAuth account.
5. B ingests source materials or runs queries inside the same workspace.
6. The server writes those updates into the same shared Google Sheet.

Important behavior:

- Workspace data still lives in PostgreSQL / Cloud SQL as the source of truth.
- The shared sheet is a synchronized collaboration view for that workspace.
- Once a user has been added through `share_shared_google_sheet`, that user can access workspace data paths guarded by the same workspace membership.
- `ingest_source_material` appends rows into the shared sheet's `Source Materials` tab when the case belongs to a workspace that already has a shared sheet.
- `search_accounting_records`, `list_review_items`, and `run_saved_view` will sync to the workspace shared sheet when `workspaceId` is present and a shared sheet exists; otherwise they fall back to the caller's personal sheet.

New collaboration tools:

- `create_shared_google_sheet`
- `share_shared_google_sheet`
- `get_shared_google_sheet`

For OAuth deployments, configure the MCP client to use Google OAuth directly. The MCP client sends the resulting Google access token as `Authorization: Bearer <token>` to this server. The server validates the token with Google, uses the Google user ID as the spreadsheet owner key, and uses the same access token to create or update that user's Sheets file.

For API key deployments, the MCP caller is read from an HTTP header. By default, the server reads `X-Accounting-User`; override this with `ACCOUNTING_MCP_USER_HEADER`. The server requires a caller identity for all MCP tool calls so database records, summaries, cancellations, and Sheets files stay user-scoped.

For example, with `GOOGLE_SHEETS_SHEET_NAME=Expenses` and `X-Accounting-User: alice@example.com`, the caller gets a spreadsheet file named `Expenses - alice@example.com`. If that user mapping does not exist yet, the service creates a new spreadsheet and stores the user-to-spreadsheet mapping in PostgreSQL. If a row with the same `expense_id` already exists in that user's file, the service updates that row instead of appending a duplicate.

Required settings:

```text
ACCOUNTING_MCP_AUTH_MODE=google_oauth
GOOGLE_SHEETS_SYNC_ENABLED=true
GOOGLE_SHEETS_SHEET_NAME=Expenses
GOOGLE_OAUTH_ALLOWED_DOMAINS=example.com
```

`GOOGLE_SHEETS_SHEET_NAME` is used as the detail tab name inside each user spreadsheet and as the spreadsheet title prefix. `GOOGLE_SHEETS_SPREADSHEET_ID` is not required because spreadsheets are created per MCP caller.

For the OAuth fields in an MCP connector UI, use:

```text
Client ID: your Google OAuth web client id
Client Secret: your Google OAuth web client secret
Auth URL: https://accounts.google.com/o/oauth2/v2/auth
Token URL: https://oauth2.googleapis.com/token
Scope: openid email profile https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive
```

Add the connector's displayed Redirect URI to the Google OAuth client's authorized redirect URIs.

The broader Drive scope is recommended when the MCP server needs to create folders, create files, upload files, or write into user-selected Drive locations instead of being limited to narrower file access patterns.

### Restricting access

The server validates bearer tokens against Google's tokeninfo endpoint, which accepts **any** valid Google access token regardless of which application issued it. Set `GOOGLE_OAUTH_ALLOWED_CLIENT_IDS` so only tokens minted by your own OAuth client are accepted:

```text
GOOGLE_OAUTH_ALLOWED_CLIENT_IDS=1234-abc.apps.googleusercontent.com
```

List every client id you use, comma-separated, if different front ends have their own OAuth clients. When this is unset, the server logs a warning at startup and accepts any Google account.

That check alone lets any Google account sign in through your own connector. To narrow it further, add one or both of:

```text
GOOGLE_OAUTH_ALLOWED_DOMAINS=example.com
GOOGLE_OAUTH_ALLOWED_EMAILS=alice@example.com,bob@example.com
```

These match the **email address of the signing-in Google account**, not the domain the MCP client is hosted on. A caller passes when its address is in `GOOGLE_OAUTH_ALLOWED_EMAILS` **or** its domain is in `GOOGLE_OAUTH_ALLOWED_DOMAINS`; leaving both unset accepts every account.

Callers rejected by these policies get `403 Forbidden` with the reason. They deliberately do not get `401`, which would tell the MCP client its token had expired and send it back through the OAuth flow to be rejected again — leaving it stuck on the Google sign-in page. `401` is reserved for a missing, expired, or revoked token.

In `api_key` mode, provide service account Google credentials with one of:

```text
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/absolute/path/to/service-account.json
GOOGLE_SERVICE_ACCOUNT_KEY_JSON={"type":"service_account",...}
```

In `google_oauth` mode, created spreadsheets are owned by the signed-in Google user. In `api_key` mode, created spreadsheets are owned by the configured service account.

## LibreChat Example

Add an MCP server entry similar to this in `librechat.yaml`:

```yaml
mcpServers:
  accounting:
    type: streamable-http
    url: http://127.0.0.1:4010/mcp
    apiKey:
      source: admin
      authorization_type: bearer
      key: ${ACCOUNTING_MCP_API_KEY}
```

If LibreChat runs in Docker and this server runs on the host machine, use a reachable host such as:

```yaml
mcpServers:
  accounting:
    type: streamable-http
    url: http://host.docker.internal:4010/mcp
    apiKey:
      source: admin
      authorization_type: bearer
      key: ${ACCOUNTING_MCP_API_KEY}
```

You may also need a matching `mcpSettings.allowedAddresses` entry in LibreChat for local/private targets.

## Docker

Build:

```bash
docker build -t accounting-mcp .
```

Run:

```bash
docker run --rm \
  -p 4010:4010 \
  -e ACCOUNTING_MCP_API_KEY=replace-with-a-long-random-token \
  -e DATABASE_URL=postgresql://postgres:password@host.docker.internal:5432/accounting \
  -e HOST=0.0.0.0 \
  accounting-mcp
```

## Suggested Agent Behavior

- Before writing data, confirm claimant, amount, expense date, and description.
- Use `add_expense` only after confirmation.
- Use `list_expenses` to verify raw rows.
- Use `cancel_expense` when a claimant needs to withdraw a mistaken record.
- Use `query_expense_summary` for reporting.
- When Sheets sync is enabled, let finance users use the MCP caller-specific spreadsheets as live detail views rather than the source of truth.
- For multi-user collaboration, create the workspace shared sheet before asking another user to upload or review data in that workspace.
- Prefer `create_shared_google_sheet` and `share_shared_google_sheet` over asking the agent to infer ad hoc sharing behavior.
- When a request includes a `workspaceId`, prefer syncing query outputs into that workspace's shared sheet rather than a personal sheet.
- Use `create_google_drive_folder` when the destination Drive folder does not exist yet.
- Prefer `upload_google_drive_file_auto` so the server chooses the upload strategy instead of relying on the agent to guess.
- Use `upload_google_drive_file` for smaller files that fit in a single tool call.
- Use `start_google_drive_upload`, `append_google_drive_upload_chunk`, and `finish_google_drive_upload` for larger files or folder trees.

## Next Production Steps

- Replace the shared Bearer token with OAuth or a gateway that maps end users to identities.
- Add approval and reimbursement workflow tools (`approve_expense`, `mark_expense_reimbursed`).
- Add approval workflow and role-based tools if finance review is needed.
