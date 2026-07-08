import type { Pool, PoolClient } from 'pg';

export type McpUserIdentity = {
  key: string;
  label: string;
  googleAccessToken?: string;
};

export type UserSpreadsheetMapping = {
  userKey: string;
  userLabel: string;
  spreadsheetId: string;
  spreadsheetUrl: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type NewUserSpreadsheet = {
  spreadsheetId: string;
  spreadsheetUrl: string | null;
  title: string;
};

type UserSpreadsheetRow = {
  user_key: string;
  user_label: string;
  spreadsheet_id: string | null;
  spreadsheet_url: string | null;
  title: string;
  status: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type Queryable = Pick<Pool | PoolClient, 'query'>;
type CreationClaim =
  | {
      action: 'return';
      mapping: UserSpreadsheetMapping;
    }
  | {
      action: 'create';
    }
  | {
      action: 'in_progress';
    };

const CREATING_STALE_MS = 2 * 60 * 1000;

function fromRow(row: UserSpreadsheetRow): UserSpreadsheetMapping {
  if (!row.spreadsheet_id) {
    throw new Error(`Spreadsheet mapping for ${row.user_key} is not ready`);
  }

  return {
    userKey: row.user_key,
    userLabel: row.user_label,
    spreadsheetId: row.spreadsheet_id,
    spreadsheetUrl: row.spreadsheet_url,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowIsReady(row: UserSpreadsheetRow): boolean {
  return row.status === 'ready' && Boolean(row.spreadsheet_id);
}

function rowIsStaleCreating(row: UserSpreadsheetRow): boolean {
  if (row.status !== 'creating') {
    return false;
  }

  return Date.now() - new Date(row.updated_at).getTime() > CREATING_STALE_MS;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown spreadsheet creation error';
}

export class UserSpreadsheetRepository {
  constructor(private readonly pool: Pool) {}

  async getOrCreateForUser(
    user: McpUserIdentity,
    createSpreadsheet: () => Promise<NewUserSpreadsheet>,
  ): Promise<UserSpreadsheetMapping> {
    const claim = await this.claimCreation(user);

    if (claim.action === 'return') {
      return claim.mapping;
    }

    if (claim.action === 'in_progress') {
      throw new Error(`Google Sheets file creation is already in progress for ${user.label}`);
    }

    try {
      const created = await createSpreadsheet();
      return await this.completeCreation(user, created);
    } catch (error) {
      await this.failCreation(user, errorMessage(error));
      throw error;
    }
  }

  private async claimCreation(user: McpUserIdentity): Promise<CreationClaim> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user.key]);

      const existing = await this.findRowByUserKey(client, user.key);
      if (existing) {
        if (rowIsReady(existing)) {
          const updated = await this.updateUserLabel(client, user);
          await client.query('COMMIT');
          return {
            action: 'return',
            mapping: updated,
          };
        }

        if (existing.status === 'creating' && !rowIsStaleCreating(existing)) {
          await client.query('COMMIT');
          return { action: 'in_progress' };
        }

        await this.markCreating(client, user);
        await client.query('COMMIT');
        return { action: 'create' };
      }

      await this.insertCreating(client, user);

      await client.query('COMMIT');
      return { action: 'create' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async findRowByUserKey(
    db: Queryable,
    userKey: string,
  ): Promise<UserSpreadsheetRow | null> {
    const result = await db.query<UserSpreadsheetRow>(
      `
      SELECT *
      FROM mcp_user_spreadsheets
      WHERE user_key = $1
      `,
      [userKey],
    );

    return result.rows[0] ?? null;
  }

  private async updateUserLabel(
    db: Queryable,
    user: McpUserIdentity,
  ): Promise<UserSpreadsheetMapping> {
    const now = new Date().toISOString();
    const result = await db.query<UserSpreadsheetRow>(
      `
      UPDATE mcp_user_spreadsheets
      SET
        user_label = $1,
        updated_at = $2
      WHERE user_key = $3
      RETURNING *
      `,
      [user.label, now, user.key],
    );

    return fromRow(result.rows[0]);
  }

  private async insertCreating(db: Queryable, user: McpUserIdentity): Promise<void> {
    const now = new Date().toISOString();
    await db.query(
      `
      INSERT INTO mcp_user_spreadsheets (
        user_key,
        user_label,
        spreadsheet_id,
        spreadsheet_url,
        title,
        status,
        last_error,
        created_at,
        updated_at
      ) VALUES ($1,$2,NULL,NULL,$3,'creating',NULL,$4,$5)
      `,
      [user.key, user.label, `Pending Google Sheets file for ${user.label}`, now, now],
    );
  }

  private async markCreating(db: Queryable, user: McpUserIdentity): Promise<void> {
    const now = new Date().toISOString();
    await db.query(
      `
      UPDATE mcp_user_spreadsheets
      SET
        user_label = $1,
        status = 'creating',
        last_error = NULL,
        updated_at = $2
      WHERE user_key = $3
      `,
      [user.label, now, user.key],
    );
  }

  private async completeCreation(
    user: McpUserIdentity,
    spreadsheet: NewUserSpreadsheet,
  ): Promise<UserSpreadsheetMapping> {
    const now = new Date().toISOString();
    const result = await this.pool.query<UserSpreadsheetRow>(
      `
      UPDATE mcp_user_spreadsheets
      SET
        user_label = $1,
        spreadsheet_id = $2,
        spreadsheet_url = $3,
        title = $4,
        status = 'ready',
        last_error = NULL,
        updated_at = $5
      WHERE user_key = $6
      RETURNING *
      `,
      [
        user.label,
        spreadsheet.spreadsheetId,
        spreadsheet.spreadsheetUrl,
        spreadsheet.title,
        now,
        user.key,
      ],
    );

    return fromRow(result.rows[0]);
  }

  private async failCreation(user: McpUserIdentity, message: string): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `
      UPDATE mcp_user_spreadsheets
      SET
        user_label = $1,
        status = 'failed',
        last_error = $2,
        updated_at = $3
      WHERE user_key = $4
      `,
      [user.label, message, now, user.key],
    );
  }

}
