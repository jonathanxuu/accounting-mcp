import { Buffer } from 'node:buffer';
import { createReadStream } from 'node:fs';
import { appendFile, mkdtemp, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { google } from 'googleapis';
import type { docs_v1, drive_v3 } from 'googleapis';

import type { McpUserIdentity } from './sheetMappings.js';

const GOOGLE_DOC_MIME_TYPE = 'application/vnd.google-apps.document';
const GOOGLE_DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DIRECT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const BINARY_FILE_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.zip',
  '.rar',
  '.7z',
  '.mp3',
  '.mp4',
  '.mov',
]);
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

export type GoogleDriveUploadSession = {
  uploadId: string;
  name: string;
  mimeType: string;
  parentFolderId: string | null;
  totalBytes: number | null;
  receivedBytes: number;
  createdAt: string;
};

export type GoogleDriveAutoUploadResult = GoogleDriveFileSummary & {
  uploadStrategy: 'direct' | 'staged';
  decodedBytes: number;
};

export type GoogleDriveFileMoveResult = GoogleDriveFileSummary & {
  previousParents: string[];
  destinationFolderId: string;
  removedParentIds: string[];
};

type UploadSessionState = GoogleDriveUploadSession & {
  userKey: string;
  tempFilePath: string;
  createdAtMs: number;
};

const uploadSessions = new Map<string, UploadSessionState>();

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

function looksLikeBinaryFileName(name: string): boolean {
  const normalizedName = name.trim().toLowerCase();
  return [...BINARY_FILE_EXTENSIONS].some((extension) => normalizedName.endsWith(extension));
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

async function deleteFileIfExists(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

export class GoogleDriveFiles {
  private async cleanupExpiredUploadSessions() {
    const now = Date.now();
    const expired = [...uploadSessions.values()].filter(
      (session) => now - session.createdAtMs > UPLOAD_SESSION_TTL_MS,
    );

    await Promise.all(
      expired.map(async (session) => {
        uploadSessions.delete(session.uploadId);
        await deleteFileIfExists(session.tempFilePath);
      }),
    );
  }

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

  private getUploadSession(user: McpUserIdentity, uploadId: string) {
    const session = uploadSessions.get(uploadId);

    if (!session || session.userKey !== user.key) {
      throw new Error(`Upload session ${uploadId} was not found for the current user`);
    }

    return session;
  }

  private async createDriveFile(
    user: McpUserIdentity,
    input: {
      name: string;
      mimeType: string;
      parentFolderId?: string;
      mediaBody?: string | Buffer | NodeJS.ReadableStream;
    },
  ) {
    const drive = this.getDriveApi(user);
    const mediaBody =
      typeof input.mediaBody === 'string' || !Buffer.isBuffer(input.mediaBody)
        ? input.mediaBody
        : Readable.from(input.mediaBody);
    const response = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: input.name,
        mimeType: input.mimeType,
        parents: input.parentFolderId ? [input.parentFolderId] : undefined,
      },
      media: mediaBody
        ? {
            mimeType: input.mimeType,
            body: mediaBody,
          }
        : undefined,
      fields: 'id,name,mimeType,modifiedTime,webViewLink,size,parents,trashed',
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

    if (endIndex > 2) {
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

  async createFolder(
    user: McpUserIdentity,
    input: {
      name: string;
      parentFolderId?: string;
    },
  ) {
    return this.createDriveFile(user, {
      name: input.name,
      mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
      parentFolderId: input.parentFolderId,
    });
  }

  async createFile(
    user: McpUserIdentity,
    input: {
      name: string;
      mimeType: string;
      parentFolderId?: string;
      content?: string;
    },
  ) {
    if (looksLikeBinaryFileName(input.name)) {
      throw new Error(
        `File ${input.name} looks like a binary upload. Use upload_google_drive_file_auto instead of create_google_drive_text_file.`,
      );
    }

    if (input.mimeType === GOOGLE_DOC_MIME_TYPE) {
      const created = await this.createDriveFile(user, {
        name: input.name,
        mimeType: input.mimeType,
        parentFolderId: input.parentFolderId,
      });

      if (input.content) {
        const docs = this.getDocsApi(user);
        await this.replaceGoogleDocContent(docs, created.id, input.content);
      }

      return {
        ...(await this.getFileMetadata(user, created.id)),
        contentKind: 'google_doc' as const,
        updatedContentLength: input.content?.length ?? 0,
      };
    }

    if (!isSupportedTextMimeType(input.mimeType)) {
      throw new Error(
        `Unsupported mime type ${input.mimeType}. Use upload_google_drive_file for binary content.`,
      );
    }

    const created = await this.createDriveFile(user, {
      name: input.name,
      mimeType: input.mimeType,
      parentFolderId: input.parentFolderId,
      mediaBody: input.content ?? '',
    });

    return {
      ...created,
      contentKind: 'text' as const,
      updatedContentLength: input.content?.length ?? 0,
    };
  }

  async uploadFile(
    user: McpUserIdentity,
    input: {
      name: string;
      mimeType: string;
      parentFolderId?: string;
      contentBase64: string;
    },
  ) {
    const content = Buffer.from(input.contentBase64, 'base64');

    return this.createDriveFile(user, {
      name: input.name,
      mimeType: input.mimeType,
      parentFolderId: input.parentFolderId,
      mediaBody: content,
    });
  }

  async uploadFileAuto(
    user: McpUserIdentity,
    input: {
      name: string;
      mimeType: string;
      parentFolderId?: string;
      contentBase64: string;
    },
  ): Promise<GoogleDriveAutoUploadResult> {
    const content = Buffer.from(input.contentBase64, 'base64');

    if (content.byteLength <= DIRECT_UPLOAD_MAX_BYTES) {
      const created = await this.createDriveFile(user, {
        name: input.name,
        mimeType: input.mimeType,
        parentFolderId: input.parentFolderId,
        mediaBody: content,
      });

      return {
        ...created,
        uploadStrategy: 'direct',
        decodedBytes: content.byteLength,
      };
    }

    const session = await this.startUpload(user, {
      name: input.name,
      mimeType: input.mimeType,
      parentFolderId: input.parentFolderId,
      totalBytes: content.byteLength,
    });

    await this.appendUploadChunk(user, {
      uploadId: session.uploadId,
      contentBase64: input.contentBase64,
    });

    const created = await this.finishUpload(user, session.uploadId);
    return {
      ...created,
      uploadStrategy: 'staged',
      decodedBytes: content.byteLength,
    };
  }

  async startUpload(
    user: McpUserIdentity,
    input: {
      name: string;
      mimeType: string;
      parentFolderId?: string;
      totalBytes?: number;
    },
  ): Promise<GoogleDriveUploadSession> {
    await this.cleanupExpiredUploadSessions();

    const uploadId = randomUUID();
    const tempDirectory = await mkdtemp(join(tmpdir(), 'accounting-mcp-drive-upload-'));
    const tempFilePath = join(tempDirectory, `${uploadId}.bin`);
    const createdAtMs = Date.now();
    const session: UploadSessionState = {
      uploadId,
      userKey: user.key,
      name: input.name,
      mimeType: input.mimeType,
      parentFolderId: input.parentFolderId ?? null,
      totalBytes: input.totalBytes ?? null,
      receivedBytes: 0,
      createdAt: new Date(createdAtMs).toISOString(),
      createdAtMs,
      tempFilePath,
    };

    uploadSessions.set(uploadId, session);
    return {
      uploadId: session.uploadId,
      name: session.name,
      mimeType: session.mimeType,
      parentFolderId: session.parentFolderId,
      totalBytes: session.totalBytes,
      receivedBytes: session.receivedBytes,
      createdAt: session.createdAt,
    };
  }

  async appendUploadChunk(
    user: McpUserIdentity,
    input: {
      uploadId: string;
      contentBase64: string;
    },
  ): Promise<GoogleDriveUploadSession> {
    const session = this.getUploadSession(user, input.uploadId);
    const chunk = Buffer.from(input.contentBase64, 'base64');
    await appendFile(session.tempFilePath, chunk);
    const fileStats = await stat(session.tempFilePath);
    session.receivedBytes = fileStats.size;

    return {
      uploadId: session.uploadId,
      name: session.name,
      mimeType: session.mimeType,
      parentFolderId: session.parentFolderId,
      totalBytes: session.totalBytes,
      receivedBytes: session.receivedBytes,
      createdAt: session.createdAt,
    };
  }

  async finishUpload(user: McpUserIdentity, uploadId: string) {
    const session = this.getUploadSession(user, uploadId);

    try {
      const created = await this.createDriveFile(user, {
        name: session.name,
        mimeType: session.mimeType,
        parentFolderId: session.parentFolderId ?? undefined,
        mediaBody: createReadStream(session.tempFilePath),
      });

      uploadSessions.delete(uploadId);
      await deleteFileIfExists(session.tempFilePath);
      return created;
    } catch (error) {
      throw error;
    }
  }

  async abortUpload(user: McpUserIdentity, uploadId: string) {
    const session = this.getUploadSession(user, uploadId);
    uploadSessions.delete(uploadId);
    await deleteFileIfExists(session.tempFilePath);

    return {
      uploadId: session.uploadId,
      deletedTempFile: true,
    };
  }

  async moveFile(
    user: McpUserIdentity,
    input: {
      fileId: string;
      destinationFolderId: string;
      removeFromPreviousParents: boolean;
    },
  ): Promise<GoogleDriveFileMoveResult> {
    const metadata = await this.getFileMetadata(user, input.fileId);
    const previousParents = metadata.parents;
    const removedParentIds = input.removeFromPreviousParents
      ? previousParents.filter((parentId) => parentId !== input.destinationFolderId)
      : [];

    if (
      previousParents.includes(input.destinationFolderId) &&
      removedParentIds.length === 0
    ) {
      return {
        ...metadata,
        previousParents,
        destinationFolderId: input.destinationFolderId,
        removedParentIds,
      };
    }

    const drive = this.getDriveApi(user);
    const updated = await drive.files.update({
      fileId: input.fileId,
      supportsAllDrives: true,
      addParents: previousParents.includes(input.destinationFolderId)
        ? undefined
        : input.destinationFolderId,
      removeParents: removedParentIds.length > 0 ? removedParentIds.join(',') : undefined,
      fields: 'id,name,mimeType,modifiedTime,webViewLink,size,parents,trashed',
    });

    return {
      ...toFileSummary(updated.data),
      previousParents,
      destinationFolderId: input.destinationFolderId,
      removedParentIds,
    };
  }
}
