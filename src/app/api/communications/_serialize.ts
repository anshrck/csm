// Shared helpers for the communications API routes.
// Filename prefixed with `_` so Next.js does NOT treat it as a route handler.
//
// The Communication model has no JSON-string columns, but it does have a Date
// field (createdAt) that must be ISO-converted on read. The authorId column
// is a plain String foreign key (no Prisma relation) — the author display
// name is stored alongside as authorName, so no extra lookup is required.

import { NextResponse } from 'next/server';
import type { Communication as PrismaCommunication } from '@prisma/client';

export type CommunicationDirection = 'TO_CUSTOMER' | 'INTERNAL_NOTE';
export type CommunicationChannel = 'PORTAL' | 'EMAIL' | 'MESSAGE';

export interface Communication {
  id: string;
  demandId: string | null;
  serviceId: string | null;
  serviceCustomerId: string | null;
  slaEventId: string | null;
  direction: CommunicationDirection;
  channel: CommunicationChannel;
  subject: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

export function serializeCommunication(row: PrismaCommunication): Communication {
  return {
    id: row.id,
    demandId: row.demandId,
    serviceId: row.serviceId,
    serviceCustomerId: row.serviceCustomerId,
    slaEventId: row.slaEventId,
    direction: row.direction as CommunicationDirection,
    channel: row.channel as CommunicationChannel,
    subject: row.subject,
    body: row.body,
    authorId: row.authorId,
    authorName: row.authorName,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Convert errors thrown by auth helpers (UNAUTHORIZED / FORBIDDEN) or
 * hand-rolled validation errors (NOT_FOUND, CONFLICT, INVALID_*) into
 * NextResponse objects with proper status codes.
 */
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
    if (err.message === 'CONFLICT') {
      return NextResponse.json({ error: 'Conflict' }, { status: 409 });
    }
    if (err.message.startsWith('INVALID_')) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
  }
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
