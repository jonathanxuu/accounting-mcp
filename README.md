# accounting-mcp

An HTTP MCP server for reimbursement collection and reporting with PostgreSQL/Cloud SQL storage and optional Google Sheets sync.

## Features

- `add_expense`: save reimbursement records
- `list_expenses`: query detailed rows with filters
- `cancel_expense`: let the claimant cancel an incorrect reimbursement record
- `query_expense_summary`: aggregate totals by claimant, category, status, currency, day, or month
- `get_accounting_usage_guide`: short usage guide for the agent
- Optional real-time sync of expense detail rows into MCP caller-specific Google Sheets files

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
curl http://localhost:4011/health
```

5. Example MCP calls:

```bash
curl -s -X POST http://localhost:4011/mcp \
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

- URL: `http://localhost:4011/mcp`
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
Scope: openid email profile https://www.googleapis.com/auth/spreadsheets
```

Add the connector's displayed Redirect URI to the Google OAuth client's authorized redirect URIs.

For production, restrict which Google accounts may call the MCP server with one or both of:

```text
GOOGLE_OAUTH_ALLOWED_DOMAINS=example.com
GOOGLE_OAUTH_ALLOWED_EMAILS=alice@example.com,bob@example.com
```

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
    url: http://127.0.0.1:4011/mcp
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
    url: http://host.docker.internal:4011/mcp
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
  -p 4011:4011 \
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

## Next Production Steps

- Replace the shared Bearer token with OAuth or a gateway that maps end users to identities.
- Add approval and reimbursement workflow tools (`approve_expense`, `mark_expense_reimbursed`).
- Add approval workflow and role-based tools if finance review is needed.
