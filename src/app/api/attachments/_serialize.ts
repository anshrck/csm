// Shared helpers for the attachments API routes.
// Filename prefixed with `_` so Next.js does NOT treat it as a route handler.

import { NextResponse } from 'next/server';
import type { Attachment as PrismaAttachment, User } from '@prisma/client';

export type AttachmentEntityType =
  | 'TICKET'
  | 'DEMAND'
  | 'CHANGE'
  | 'PROBLEM'
  | 'SLA_EVENT'
  | 'COMMENT';

export interface Uploader {
  id: string;
  name: string;
  role: string;
  avatarColor: string;
}

export interface Attachment {
  id: string;
  entityType: AttachmentEntityType;
  entityId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  uploadedById: string;
  uploadedByName?: string;
  uploader?: Uploader;
  url: string; // relative URL for download (storageKey prefixed with /)
  createdAt: string;
}

export const ATTACHMENT_INCLUDE = { uploader: true } as const;
export type AttachmentWithUploader = PrismaAttachment & { uploader: User };

// Allowed MIME types — enforced on upload. Wildcards are expanded manually
// because the matching is done in JS, not by a mime-db.
const ALLOWED_MIME_PREFIXES = ['image/', 'text/'];
const ALLOWED_MIME_EXACT = new Set([
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.slide',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  'application/vnd.openxmlformats-officedocument.presentationml.template',
]);

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export function isAllowedMime(mime: string): boolean {
  if (!mime) return false;
  if (ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;
  return ALLOWED_MIME_EXACT.has(mime.toLowerCase());
}

function serializeUploader(u: User): Uploader {
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    avatarColor: u.avatarColor,
  };
}

export function serializeAttachment(
  a: PrismaAttachment & { uploader?: User },
): Attachment {
  return {
    id: a.id,
    entityType: a.entityType as AttachmentEntityType,
    entityId: a.entityId,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    storageKey: a.storageKey,
    uploadedById: a.uploadedById,
    uploadedByName: a.uploader?.name,
    uploader: a.uploader ? serializeUploader(a.uploader) : undefined,
    url: a.storageKey.startsWith('/') ? a.storageKey : `/${a.storageKey}`,
    createdAt: a.createdAt.toISOString(),
  };
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof Error) {
    if (err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (err.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (err.message.startsWith('INVALID_')) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
  }
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export const VALID_ATTACHMENT_ENTITY_TYPES = new Set<AttachmentEntityType>([
  'TICKET',
  'DEMAND',
  'CHANGE',
  'PROBLEM',
  'SLA_EVENT',
  'COMMENT',
]);

export function asAttachmentEntityType(v: unknown): AttachmentEntityType | null {
  return typeof v === 'string' &&
    VALID_ATTACHMENT_ENTITY_TYPES.has(v as AttachmentEntityType)
    ? (v as AttachmentEntityType)
    : null;
}

// Build a safe, unique storage key. The original filename is sanitised to
// ASCII alphanumerics + dashes; a timestamp + short random suffix guarantees
// uniqueness. Stored under `uploads/yyyy-mm/`.
export function buildStorageKey(fileName: string): string {
  const safe = fileName
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'file';
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const d = new Date();
  const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `uploads/${month}/${ts}-${rand}-${safe}`;
}

// Human-readable file size for the UI.
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
