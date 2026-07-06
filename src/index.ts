import 'dotenv/config';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { Request, Response, NextFunction } from 'express';

import { loadConfig } from './config.js';
import { createAccountingServer } from './mcp.js';
import { createPool, initializeDatabase } from './postgres.js';
import { ExpenseRepository } from './repository.js';
import { GoogleSheetsSync } from './sheets.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await initializeDatabase(pool);
const repository = new ExpenseRepository(pool);
const sheetsSync = config.sheets.enabled ? new GoogleSheetsSync(config.sheets) : null;
const app = createMcpExpressApp({
  host: config.host,
  allowedHosts: config.allowedHosts.length > 0 ? config.allowedHosts : undefined,
});

function authenticateRequest(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.header('authorization');
  const expected = `Bearer ${config.apiKey}`;

  if (authHeader !== expected) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Provide a valid Bearer token in the Authorization header.',
    });
    return;
  }

  next();
}

app.use('/mcp', authenticateRequest);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'accounting-mcp',
    database: 'postgres',
    sheetsSyncEnabled: config.sheets.enabled,
  });
});

app.post('/mcp', async (req, res) => {
  const server = createAccountingServer(repository, sheetsSync);

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
