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

export type SharedSpreadsheetMapping = {
  workspaceId: string;
  ownerUserKey: string;
  ownerUserLabel: string;
  spreadsheetId: string;
  spreadsheetUrl: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type SharedSpreadsheetMember = {
  workspaceId: string;
  memberIdentity: string;
  memberKey: string | null;
  memberLabel: string;
  memberEmail: string | null;
  role: 'owner' | 'editor' | 'viewer';
  createdAt: string;
  updatedAt: string;
};

export type SharedSpreadsheetAccess = SharedSpreadsheetMapping & {
  role: 'owner' | 'editor' | 'viewer';
  memberIdentity: string;
};

export type NewUserSpreadsheet = {
  spreadsheetId: string;
  spreadsheetUrl: string | null;
  title: string;
};

export type NewSharedSpreadsheet = {
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

type SharedSpreadsheetRow = {
  workspace_id: string;
  owner_user_key: string;
  owner_user_label: string;
  spreadsheet_id: string | null;
  spreadsheet_url: string | null;
  title: string;
  status: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type SharedSpreadsheetMemberRow = {
  workspace_id: string;
  member_identity: string;
  member_key: string | null;
  member_label: string;
  member_email: string | null;
  role: 'owner' | 'editor' | 'viewer';
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

type SharedCreationClaim =
  | {
      action: 'return';
      mapping: SharedSpreadsheetMapping;
    }
  | {
      action: 'create';
    }
  | {
      action: 'in_progress';
    };

const CREATING_STALE_MS = 2 * 60 * 1000;

export function identityEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.includes('@') ? normalized : null;
}

export function memberIdentityForUser(user: McpUserIdentity): string {
  return identityEmail(user.label) ?? user.key;
}

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

function fromSharedRow(row: SharedSpreadsheetRow): SharedSpreadsheetMapping {
  if (!row.spreadsheet_id) {
    throw new Error(`Shared spreadsheet mapping for workspace ${row.workspace_id} is not ready`);
  }

  return {
    workspaceId: row.workspace_id,
    ownerUserKey: row.owner_user_key,
    ownerUserLabel: row.owner_user_label,
    spreadsheetId: row.spreadsheet_id,
    spreadsheetUrl: row.spreadsheet_url,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function memberFromRow(row: SharedSpreadsheetMemberRow): SharedSpreadsheetMember {
  return {
    workspaceId: row.workspace_id,
    memberIdentity: row.member_identity,
    memberKey: row.member_key,
    memberLabel: row.member_label,
    memberEmail: row.member_email,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowIsReady(row: UserSpreadsheetRow): boolean {
  return row.status === 'ready' && Boolean(row.spreadsheet_id);
}

function sharedRowIsReady(row: SharedSpreadsheetRow): boolean {
  return row.status === 'ready' && Boolean(row.spreadsheet_id);
}

function rowIsStaleCreating(row: { status: string; updated_at: string }): boolean {
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

  async getOrCreateForWorkspace(
    workspaceId: string,
    owner: McpUserIdentity,
    createSpreadsheet: () => Promise<NewSharedSpreadsheet>,
  ): Promise<SharedSpreadsheetMapping> {
    const claim = await this.claimSharedCreation(workspaceId, owner);

    if (claim.action === 'return') {
      return claim.mapping;
    }

    if (claim.action === 'in_progress') {
      throw new Error(`Google Sheets shared file creation is already in progress for workspace ${workspaceId}`);
    }

    try {
      const created = await createSpreadsheet();
      return await this.completeSharedCreation(workspaceId, owner, created);
    } catch (error) {
      await this.failSharedCreation(workspaceId, owner, errorMessage(error));
      throw error;
    }
  }

  async getSharedSpreadsheet(workspaceId: string): Promise<SharedSpreadsheetMapping | null> {
    const result = await this.pool.query<SharedSpreadsheetRow>(
      `
      SELECT *
      FROM shared_spreadsheets
      WHERE workspace_id = $1
        AND status = 'ready'
        AND spreadsheet_id IS NOT NULL
      `,
      [workspaceId],
    );

    const row = result.rows[0];
    return row ? fromSharedRow(row) : null;
  }

  async getSharedSpreadsheetBySpreadsheetId(
    spreadsheetId: string,
  ): Promise<SharedSpreadsheetMapping | null> {
    const result = await this.pool.query<SharedSpreadsheetRow>(
      `
      SELECT *
      FROM shared_spreadsheets
      WHERE spreadsheet_id = $1
        AND status = 'ready'
      LIMIT 1
      `,
      [spreadsheetId],
    );

    const row = result.rows[0];
    return row ? fromSharedRow(row) : null;
  }

  async getSharedSpreadsheetForUser(
    workspaceId: string,
    user: McpUserIdentity,
  ): Promise<SharedSpreadsheetAccess | null> {
    const shared = await this.getSharedSpreadsheet(workspaceId);
    if (!shared) {
      return null;
    }

    if (shared.ownerUserKey === user.key) {
      return {
        ...shared,
        role: 'owner',
        memberIdentity: memberIdentityForUser(user),
      };
    }

    const result = await this.pool.query<SharedSpreadsheetMemberRow>(
      `
      SELECT *
      FROM shared_spreadsheet_members
      WHERE workspace_id = $1
        AND (member_key = $2 OR member_identity = $3)
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END
      LIMIT 1
      `,
      [workspaceId, user.key, memberIdentityForUser(user)],
    );

    const member = result.rows[0];
    if (!member) {
      return null;
    }

    return {
      ...shared,
      role: member.role,
      memberIdentity: member.member_identity,
    };
  }

  async getSharedSpreadsheetForUserBySpreadsheetId(
    spreadsheetId: string,
    user: McpUserIdentity,
  ): Promise<SharedSpreadsheetAccess | null> {
    const shared = await this.getSharedSpreadsheetBySpreadsheetId(spreadsheetId);
    if (!shared) {
      return null;
    }

    return this.getSharedSpreadsheetForUser(shared.workspaceId, user);
  }

  async listSharedSpreadsheetMembers(workspaceId: string): Promise<SharedSpreadsheetMember[]> {
    const result = await this.pool.query<SharedSpreadsheetMemberRow>(
      `
      SELECT *
      FROM shared_spreadsheet_members
      WHERE workspace_id = $1
      ORDER BY created_at ASC
      `,
      [workspaceId],
    );

    return result.rows.map(memberFromRow);
  }

  async addSharedSpreadsheetMember(input: {
    workspaceId: string;
    memberIdentity: string;
    memberKey?: string | null;
    memberLabel: string;
    memberEmail?: string | null;
    role: 'editor' | 'viewer';
  }): Promise<SharedSpreadsheetMember> {
    const now = new Date().toISOString();
    const result = await this.pool.query<SharedSpreadsheetMemberRow>(
      `
      INSERT INTO shared_spreadsheet_members (
        workspace_id,
        member_identity,
        member_key,
        member_label,
        member_email,
        role,
        created_at,
        updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (workspace_id, member_identity)
      DO UPDATE SET
        member_key = EXCLUDED.member_key,
        member_label = EXCLUDED.member_label,
        member_email = EXCLUDED.member_email,
        role = EXCLUDED.role,
        updated_at = EXCLUDED.updated_at
      RETURNING *
      `,
      [
        input.workspaceId,
        input.memberIdentity,
        input.memberKey ?? null,
        input.memberLabel,
        input.memberEmail ?? null,
        input.role,
        now,
        now,
      ],
    );

    return memberFromRow(result.rows[0]);
  }

  async resetInterruptedCreations(): Promise<number> {
    const now = new Date().toISOString();
    const result = await this.pool.query(
      `
      UPDATE mcp_user_spreadsheets
      SET
        status = 'failed',
        last_error = $1,
        updated_at = $2
      WHERE status = 'creating'
      `,
      ['Interrupted spreadsheet creation reset on server startup', now],
    );

    return result.rowCount ?? 0;
  }

  async resetInterruptedSharedCreations(): Promise<number> {
    const now = new Date().toISOString();
    const result = await this.pool.query(
      `
      UPDATE shared_spreadsheets
      SET
        status = 'failed',
        last_error = $1,
        updated_at = $2
      WHERE status = 'creating'
      `,
      ['Interrupted shared spreadsheet creation reset on server startup', now],
    );

    return result.rowCount ?? 0;
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

  private async claimSharedCreation(
    workspaceId: string,
    owner: McpUserIdentity,
  ): Promise<SharedCreationClaim> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`shared:${workspaceId}`]);

      const existing = await this.findSharedRowByWorkspaceId(client, workspaceId);
      if (existing) {
        if (sharedRowIsReady(existing)) {
          const updated = await this.updateSharedOwnerLabel(client, workspaceId, owner);
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

        await this.markSharedCreating(client, workspaceId, owner);
        await client.query('COMMIT');
        return { action: 'create' };
      }

      await this.insertSharedCreating(client, workspaceId, owner);
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

  private async findSharedRowByWorkspaceId(
    db: Queryable,
    workspaceId: string,
  ): Promise<SharedSpreadsheetRow | null> {
    const result = await db.query<SharedSpreadsheetRow>(
      `
      SELECT *
      FROM shared_spreadsheets
      WHERE workspace_id = $1
      `,
      [workspaceId],
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

  private async updateSharedOwnerLabel(
    db: Queryable,
    workspaceId: string,
    owner: McpUserIdentity,
  ): Promise<SharedSpreadsheetMapping> {
    const now = new Date().toISOString();
    const result = await db.query<SharedSpreadsheetRow>(
      `
      UPDATE shared_spreadsheets
      SET
        owner_user_label = $1,
        updated_at = $2
      WHERE workspace_id = $3
      RETURNING *
      `,
      [owner.label, now, workspaceId],
    );

    return fromSharedRow(result.rows[0]);
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

  private async insertSharedCreating(
    db: Queryable,
    workspaceId: string,
    owner: McpUserIdentity,
  ): Promise<void> {
    const now = new Date().toISOString();
    await db.query(
      `
      INSERT INTO shared_spreadsheets (
        workspace_id,
        owner_user_key,
        owner_user_label,
        spreadsheet_id,
        spreadsheet_url,
        title,
        status,
        last_error,
        created_at,
        updated_at
      ) VALUES ($1,$2,$3,NULL,NULL,$4,'creating',NULL,$5,$6)
      `,
      [workspaceId, owner.key, owner.label, `Pending shared Google Sheets file for ${workspaceId}`, now, now],
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

  private async markSharedCreating(
    db: Queryable,
    workspaceId: string,
    owner: McpUserIdentity,
  ): Promise<void> {
    const now = new Date().toISOString();
    await db.query(
      `
      UPDATE shared_spreadsheets
      SET
        owner_user_key = $1,
        owner_user_label = $2,
        status = 'creating',
        last_error = NULL,
        updated_at = $3
      WHERE workspace_id = $4
      `,
      [owner.key, owner.label, now, workspaceId],
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

  private async completeSharedCreation(
    workspaceId: string,
    owner: McpUserIdentity,
    spreadsheet: NewSharedSpreadsheet,
  ): Promise<SharedSpreadsheetMapping> {
    const now = new Date().toISOString();
    const result = await this.pool.query<SharedSpreadsheetRow>(
      `
      UPDATE shared_spreadsheets
      SET
        owner_user_key = $1,
        owner_user_label = $2,
        spreadsheet_id = $3,
        spreadsheet_url = $4,
        title = $5,
        status = 'ready',
        last_error = NULL,
        updated_at = $6
      WHERE workspace_id = $7
      RETURNING *
      `,
      [
        owner.key,
        owner.label,
        spreadsheet.spreadsheetId,
        spreadsheet.spreadsheetUrl,
        spreadsheet.title,
        now,
        workspaceId,
      ],
    );

    await this.addSharedSpreadsheetMember({
      workspaceId,
      memberIdentity: memberIdentityForUser(owner),
      memberKey: owner.key,
      memberLabel: owner.label,
      memberEmail: identityEmail(owner.label),
      role: 'editor',
    });

    return fromSharedRow(result.rows[0]);
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

  private async failSharedCreation(
    workspaceId: string,
    owner: McpUserIdentity,
    message: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `
      UPDATE shared_spreadsheets
      SET
        owner_user_key = $1,
        owner_user_label = $2,
        status = 'failed',
        last_error = $3,
        updated_at = $4
      WHERE workspace_id = $5
      `,
      [owner.key, owner.label, message, now, workspaceId],
    );
  }
}
