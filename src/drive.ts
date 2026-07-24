import { Buffer } from 'node:buffer';

import { google } from 'googleapis';
import type { docs_v1, drive_v3 } from 'googleapis';

import type { McpUserIdentity } from './sheetMappings.js';

const GOOGLE_DOC_MIME_TYPE = 'application/vnd.google-apps.document';
const SUPPORTED_TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/javascript',
  'application/x-javascript',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/typescript',
  'application/x-typescript',
]);

export type GoogleDriveFileSummary = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  webViewLink: string | null;
  size: string | null;
  parents: string[];
  trashed: boolean;
};

export type GoogleDriveFileContent = GoogleDriveFileSummary & {
  content: string;
  contentKind: 'google_doc' | 'text';
};

export type GoogleDriveFileUpdateResult = GoogleDriveFileSummary & {
  contentKind: 'google_doc' | 'text';
  updatedContentLength: number;
};

function requireGoogleAccessToken(user: McpUserIdentity): string {
  if (!user.googleAccessToken) {
    throw new Error('Google Drive access requires a Google OAuth access token');
  }

  return user.googleAccessToken;
}

function toOAuthClient(user: McpUserIdentity) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({
    access_token: requireGoogleAccessToken(user),
  });
  return auth;
}

function toFileSummary(file: drive_v3.Schema$File): GoogleDriveFileSummary {
  if (!file.id || !file.name || !file.mimeType) {
    throw new Error('Google Drive file metadata is missing required fields');
  }

  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime ?? null,
    webViewLink: file.webViewLink ?? null,
    size: file.size ?? null,
    parents: file.parents ?? [],
    trashed: file.trashed ?? false,
  };
}

function isSupportedTextMimeType(mimeType: string): boolean {
  return mimeType.startsWith('text/') || SUPPORTED_TEXT_MIME_TYPES.has(mimeType);
}

function buildDriveQuery(input: {
  query?: string;
  folderId?: string;
  mimeType?: string;
  includeTrashed: boolean;
}) {
  const parts: string[] = [];

  if (!input.includeTrashed) {
    parts.push('trashed = false');
  }

  if (input.folderId) {
    parts.push(`'${input.folderId.replaceAll("'", "\\'")}' in parents`);
  }

  if (input.mimeType) {
    parts.push(`mimeType = '${input.mimeType.replaceAll("'", "\\'")}'`);
  }

  if (input.query) {
    const escaped = input.query.replaceAll("'", "\\'");
    parts.push(`(name contains '${escaped}' or fullText contains '${escaped}')`);
  }

  return parts.join(' and ');
}

export class GoogleDriveFiles {
  private getDriveApi(user: McpUserIdentity) {
    return google.drive({
      version: 'v3',
      auth: toOAuthClient(user),
    });
  }

  private getDocsApi(user: McpUserIdentity) {
    return google.docs({
      version: 'v1',
      auth: toOAuthClient(user),
    });
  }

  private async getFileMetadata(user: McpUserIdentity, fileId: string) {
    const drive = this.getDriveApi(user);
    const response = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,modifiedTime,webViewLink,size,parents,trashed',
      supportsAllDrives: true,
    });

    return toFileSummary(response.data);
  }

  async listFiles(
    user: McpUserIdentity,
    input: {
      query?: string;
      folderId?: string;
      mimeType?: string;
      pageSize: number;
      includeTrashed: boolean;
    },
  ) {
    const drive = this.getDriveApi(user);
    const response = await drive.files.list({
      q: buildDriveQuery(input) || undefined,
      pageSize: input.pageSize,
      orderBy: 'modifiedTime desc',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: 'nextPageToken, files(id,name,mimeType,modifiedTime,webViewLink,size,parents,trashed)',
    });

    return {
      items: (response.data.files ?? []).map(toFileSummary),
      nextPageToken: response.data.nextPageToken ?? null,
    };
  }

  async readFile(user: McpUserIdentity, fileId: string): Promise<GoogleDriveFileContent> {
    const metadata = await this.getFileMetadata(user, fileId);
    const drive = this.getDriveApi(user);

    if (metadata.mimeType === GOOGLE_DOC_MIME_TYPE) {
      const exported = await drive.files.export(
        {
          fileId,
          mimeType: 'text/plain',
        },
        {
          responseType: 'arraybuffer',
        },
      );

      return {
        ...metadata,
        content: Buffer.from(exported.data as ArrayBuffer).toString('utf8'),
        contentKind: 'google_doc',
      };
    }

    if (!isSupportedTextMimeType(metadata.mimeType)) {
      throw new Error(
        `File ${metadata.name} uses unsupported mime type ${metadata.mimeType}. Only Google Docs and text-like files are supported.`,
      );
    }

    const media = await drive.files.get(
      {
        fileId,
        alt: 'media',
        supportsAllDrives: true,
      },
      {
        responseType: 'arraybuffer',
      },
    );

    return {
      ...metadata,
      content: Buffer.from(media.data as ArrayBuffer).toString('utf8'),
      contentKind: 'text',
    };
  }

  private async replaceGoogleDocContent(
    docs: docs_v1.Docs,
    fileId: string,
    content: string,
  ) {
    const document = await docs.documents.get({
      documentId: fileId,
    });

    const bodyContent = document.data.body?.content ?? [];
    const endIndex = bodyContent[bodyContent.length - 1]?.endIndex ?? 1;
    const requests: docs_v1.Schema$Request[] = [];

    if (endIndex > 1) {
      requests.push({
        deleteContentRange: {
          range: {
            startIndex: 1,
            endIndex: endIndex - 1,
          },
        },
      });
    }

    if (content.length > 0) {
      requests.push({
        insertText: {
          location: {
            index: 1,
          },
          text: content,
        },
      });
    }

    if (requests.length === 0) {
      return;
    }

    await docs.documents.batchUpdate({
      documentId: fileId,
      requestBody: {
        requests,
      },
    });
  }

  async updateFile(
    user: McpUserIdentity,
    input: {
      fileId: string;
      content: string;
    },
  ): Promise<GoogleDriveFileUpdateResult> {
    const metadata = await this.getFileMetadata(user, input.fileId);

    if (metadata.mimeType === GOOGLE_DOC_MIME_TYPE) {
      const docs = this.getDocsApi(user);
      await this.replaceGoogleDocContent(docs, input.fileId, input.content);

      return {
        ...(await this.getFileMetadata(user, input.fileId)),
        contentKind: 'google_doc',
        updatedContentLength: input.content.length,
      };
    }

    if (!isSupportedTextMimeType(metadata.mimeType)) {
      throw new Error(
        `File ${metadata.name} uses unsupported mime type ${metadata.mimeType}. Only Google Docs and text-like files are supported.`,
      );
    }

    const drive = this.getDriveApi(user);
    const updated = await drive.files.update({
      fileId: input.fileId,
      supportsAllDrives: true,
      requestBody: {
        mimeType: metadata.mimeType,
      },
      media: {
        mimeType: metadata.mimeType,
        body: input.content,
      },
      fields: 'id,name,mimeType,modifiedTime,webViewLink,size,parents,trashed',
    });

    return {
      ...toFileSummary(updated.data),
      contentKind: 'text',
      updatedContentLength: input.content.length,
    };
  }
}
