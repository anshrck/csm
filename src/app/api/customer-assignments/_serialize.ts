// Shared helpers for the customer-assignments API routes.
// Filename prefixed with `_` so Next.js does NOT treat it as a route handler.

import { NextResponse } from 'next/server';

// ---- Serializer types -----------------------------------------------------

interface AssignmentRow {
  id: string;
  orgNodeId: string;
  userId: string;
  role: string;
  active: boolean;
  createdAt: Date;
  orgNode: { id: string; name: string; type: string; parentId: string | null };
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    avatarColor: string;
    title: string | null;
  };
}

export type { AssignmentRow };

export interface SerializedAssignment {
  id: string;
  orgNodeId: string;
  orgNodeName: string;
  orgNodeType: string;
  orgNodeParentId: string | null;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  userAvatarColor: string;
  userTitle: string | null;
  role: string;
  active: boolean;
  createdAt: string;
}

export function serializeAssignment(r: AssignmentRow): SerializedAssignment {
  return {
    id: r.id,
    orgNodeId: r.orgNodeId,
    orgNodeName: r.orgNode.name,
    orgNodeType: r.orgNode.type,
    orgNodeParentId: r.orgNode.parentId,
    userId: r.userId,
    userName: r.user.name,
    userEmail: r.user.email,
    userRole: r.user.role,
    userAvatarColor: r.user.avatarColor,
    userTitle: r.user.title,
    role: r.role,
    active: r.active,
    createdAt: r.createdAt.toISOString(),
  };
}

export const ASSIGNMENT_INCLUDE = {
  orgNode: { select: { id: true, name: true, type: true, parentId: true } },
  user: {
    select: { id: true, name: true, email: true, role: true, avatarColor: true, title: true },
  },
} as const;

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof Error) {
    if (err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (
      err.message.startsWith('INVALID_') ||
      err.message === 'NOT_FOUND' ||
      err.message === 'CONFLICT'
    ) {
      const status =
        err.message === 'NOT_FOUND' ? 404 : err.message === 'CONFLICT' ? 409 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
  }
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
