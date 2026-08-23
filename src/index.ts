import 'dotenv/config';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { Request, Response, NextFunction } from 'express';

import { authenticateGoogleAccessToken, GoogleOAuthForbiddenError } from './googleOAuth.js';
import { loadConfig } from './config.js';
import { createAccountingServer } from './mcp.js';
import { createPool, initializeDatabase } from './postgres.js';
import { ExpenseRepository } from './repository.js';
import { UserSpreadsheetRepository } from './sheetMappings.js';
import type { McpUserIdentity } from './sheetMappings.js';
import { GoogleSheetsSync } from './sheets.js';
import { WorkflowRepository } from './workflowRepository.js';

const config = loadConfig();

// Google's tokeninfo endpoint validates any Google access token, whoever issued
// it. With no audience and no email/domain allowlist, every Google account on
// the internet can reach this server's tools.
if (
  config.authMode === 'google_oauth' &&
  config.googleOAuthAllowedClientIds.length === 0 &&
  config.googleOAuthAllowedEmails.length === 0 &&
  config.googleOAuthAllowedDomains.length === 0
) {
  console.warn(
    'Warning: google_oauth mode accepts any valid Google access token. ' +
      'Set GOOGLE_OAUTH_ALLOWED_CLIENT_IDS to restrict access to tokens issued by your own OAuth client.',
  );
}

const pool = createPool(config.databaseUrl);
await initializeDatabase(pool);
const repository = new ExpenseRepository(pool);
const workflowRepository = new WorkflowRepository(pool);
const spreadsheetRepository = new UserSpreadsheetRepository(pool);

// Heal spreadsheet creations that a previous crash or restart left half-done.
// A stale `creating` row would otherwise keep every sync for that user stuck on
// "creation already in progress" until it ages out of the stale window.
const interruptedCreations = await spreadsheetRepository.resetInterruptedCreations();
if (interruptedCreations > 0) {
  console.warn(
    `Reset ${interruptedCreations} interrupted Google Sheets creation(s) left over from a previous run.`,
  );
}

const interruptedSharedCreations = await spreadsheetRepository.resetInterruptedSharedCreations();
if (interruptedSharedCreations > 0) {
  console.warn(
    `Reset ${interruptedSharedCreations} interrupted shared Google Sheets creation(s) left over from a previous run.`,
  );
}

const sheetsSync = config.sheets.enabled
  ? new GoogleSheetsSync(config.sheets, spreadsheetRepository)
  : null;
const app = createMcpExpressApp({
  host: config.host,
  allowedHosts: config.allowedHosts.length > 0 ? config.allowedHosts : undefined,
});

function bearerToken(req: Request): string | null {
  const authHeader = req.header('authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice('Bearer '.length).trim() || null;
}

/** The token is missing or unusable; the client should obtain a new one and retry. */
function rejectUnauthorized(res: Response, message: string) {
  res.setHeader('WWW-Authenticate', 'Bearer');
  res.status(401).json({
    error: 'Unauthorized',
    message,
  });
}

/**
 * The caller is authenticated but not permitted. Deliberately omits
 * `WWW-Authenticate` so OAuth clients surface the error instead of looping
 * through the sign-in flow with a token that will be rejected identically.
 */
function rejectForbidden(res: Response, message: string) {
  res.status(403).json({
    error: 'Forbidden',
    message,
  });
}

async function authenticateRequest(req: Request, res: Response, next: NextFunction) {
  const token = bearerToken(req);

  if (!token) {
    rejectUnauthorized(res, 'Provide a valid Bearer token in the Authorization header.');
    return;
  }

  if (config.authMode === 'api_key') {
    if (token !== config.apiKey) {
      rejectUnauthorized(res, 'Provide a valid API key Bearer token in the Authorization header.');
      return;
    }

    res.locals.mcpUser = resolveMcpUser(req);
    next();
    return;
  }

  try {
    res.locals.mcpUser = await authenticateGoogleAccessToken(token, {
      allowedClientIds: config.googleOAuthAllowedClientIds,
      allowedEmails: config.googleOAuthAllowedEmails,
      allowedDomains: config.googleOAuthAllowedDomains,
    });
  } catch (error) {
    console.error('Failed to authenticate Google OAuth token', error);

    // Policy rejections are permanent for this identity, so they answer 403.
    // Returning 401 here would tell the client its token went stale, sending it
    // back through the OAuth flow to be rejected again, forever.
    if (error instanceof GoogleOAuthForbiddenError) {
      rejectForbidden(res, error.message);
      return;
    }

    rejectUnauthorized(res, 'Provide a valid Google OAuth Bearer token.');
    return;
  }

  next();
}

function resolveMcpUser(req: Request): McpUserIdentity | null {
  const headerValue = req.header(config.userHeader)?.trim();

  if (!headerValue) {
    return null;
  }

  return {
    key: headerValue,
    label: headerValue,
  };
}

app.use('/mcp', (req, res, next) => {
  void authenticateRequest(req, res, next).catch((error) => {
    console.error('Failed to authenticate MCP request', error);

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to authenticate MCP request.',
      });
    }
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'accounting-mcp',
    database: 'postgres',
    sheetsSyncEnabled: config.sheets.enabled,
  });
});

app.post('/mcp', async (req, res) => {
  const mcpUser = (res.locals.mcpUser as McpUserIdentity | undefined) ?? null;

  if (!mcpUser) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32602,
        message:
          config.authMode === 'api_key'
            ? `Missing MCP user identity header: ${config.userHeader}`
            : 'Missing MCP user identity',
      },
      id: null,
    });
    return;
  }

  const server = createAccountingServer(repository, workflowRepository, sheetsSync, mcpUser);

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on('close', () => {
      void transport.close();
      void server.close();
    });
  } catch (error) {
    console.error('Failed to handle MCP request', error);

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }

    await server.close();
  }
});

app.get('/mcp', (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'Method not allowed.',
    },
    id: null,
  });
});

app.delete('/mcp', (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'Method not allowed.',
    },
    id: null,
  });
});

app.listen(config.port, config.host, (error?: Error) => {
  if (error) {
    console.error('Failed to start accounting MCP server', error);
    process.exit(1);
  }

  console.log(`Accounting MCP server listening on http://${config.host}:${config.port}`);
});

process.on('SIGINT', () => {
  void pool.end().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  void pool.end().finally(() => process.exit(0));
});
