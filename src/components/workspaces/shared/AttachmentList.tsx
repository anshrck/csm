'use client';

/**
 * AttachmentList — drop-in file attachment widget for any entity detail page.
 *
 * Props:
 *   entityType — 'TICKET' | 'DEMAND' | 'CHANGE' | 'PROBLEM' | 'SLA_EVENT' | 'COMMENT'
 *   entityId   — string
 *
 * Behaviour:
 *   - GET /api/attachments?entityType=…&entityId=… on mount + every 10s.
 *   - Upload via multipart POST /api/attachments (file + entityType + entityId).
 *     Enforced server-side: 10 MB max, image/* + PDF + text/* + Office docs.
 *   - Download: link to the public file URL (storageKey relative path).
 *   - Delete: DELETE /api/attachments/[id] — uploader or CM Leader only.
 */

import * as React from 'react';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  File as FileIcon,
  Paperclip,
  Trash2,
  Download,
  Upload,
  Clock,
  RefreshCw,
} from 'lucide-react';

import { useApp } from '@/lib/store';
import { apiDelete, apiGet } from '@/lib/api';
import {
  Badge,
  Button,
  EmptyState,
  LoadingState,
  RelativeTime,
  UserAvatar,
} from '@/components/shared';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type EntityType = 'TICKET' | 'DEMAND' | 'CHANGE' | 'PROBLEM' | 'SLA_EVENT' | 'COMMENT';

interface Uploader {
  id: string;
  name: string;
  role: string;
  avatarColor: string;
}

interface Attachment {
  id: string;
  entityType: EntityType;
  entityId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  uploadedById: string;
  uploadedByName?: string;
  uploader?: Uploader;
  url: string;
  createdAt: string;
}

interface Props {
  entityType: EntityType | string;
  entityId: string;
  className?: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return <ImageIcon className="size-4 text-teal-600" />;
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('ms-excel'))
    return <FileSpreadsheet className="size-4 text-emerald-600" />;
  if (mime === 'application/pdf') return <FileText className="size-4 text-rose-600" />;
  return <FileIcon className="size-4 text-muted-foreground" />;
}

export function AttachmentList({ entityType, entityId, className }: Props) {
  const { session } = useApp();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const queryKey = useMemo(
    () => ['attachments', entityType, entityId] as const,
    [entityType, entityId],
  );

  const { data: attachments, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      apiGet<Attachment[]>(
        `/api/attachments?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
      ),
    enabled: !!entityId,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  // --- upload ---
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('entityType', entityType);
      form.append('entityId', entityId);
      form.append('file', file);
      const res = await fetch('/api/attachments', {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        let message = `${res.status} ${res.statusText}`;
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }
      return (await res.json()) as Attachment;
    },
    onSuccess: (att) => {
      toast.success('File uploaded', { description: att.fileName });
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => toast.error('Upload failed', { description: e.message }),
  });

  // --- delete ---
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/attachments/${id}`),
    onSuccess: () => {
      toast.success('Attachment removed');
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => toast.error('Could not delete attachment', { description: e.message }),
  });

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    for (const f of files) uploadMutation.mutate(f);
    // Reset the input so the same file can be re-selected.
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const canDelete = (a: Attachment) =>
    session?.id === a.uploadedById || session?.role === 'CM_LEADER';

  const rows = attachments ?? [];

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Paperclip className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">Attachments</h3>
          <Badge variant="outline" className="tabular-nums">
            {rows.length}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
                Refresh
              </Button>
            </TooltipTrigger>
            <TooltipContent>Auto-refreshes every 10s</TooltipContent>
          </Tooltip>
          <Button
            size="sm"
            className="h-7 gap-1.5"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
          >
            {uploadMutation.isPending ? (
              <>
                <Clock className="size-3.5 animate-pulse" /> Uploading…
              </>
            ) : (
              <>
                <Upload className="size-3.5" /> Upload
              </>
            )}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onFileSelected}
            accept="image/*,application/pdf,text/*,.xls,.xlsx,.doc,.docx,.ppt,.pptx"
          />
        </div>
      </div>

      {isLoading ? (
        <LoadingState rows={2} />
      ) : isError ? (
        <EmptyState
          icon={<Paperclip className="size-8" />}
          title="Couldn't load attachments"
          description="Try refreshing the list."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Paperclip className="size-8" />}
          title="No attachments yet"
          description="Upload screenshots, logs, PDFs, or Office docs (max 10 MB each)."
        />
      ) : (
        <ul className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin pr-1">
          {rows.map((a, idx) => (
            <motion.li
              key={a.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, delay: idx * 0.02 }}
              className="flex items-center gap-3 rounded-md border bg-card p-2.5"
            >
              <div className="grid size-9 place-items-center rounded-md bg-muted shrink-0">
                {fileIcon(a.mimeType)}
              </div>
              <div className="flex-1 min-w-0">
                <a
                  href={a.url}
                  download={a.fileName}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium hover:underline truncate block max-w-full"
                  title={a.fileName}
                >
                  {a.fileName}
                </a>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="tabular-nums">{formatBytes(a.sizeBytes)}</span>
                  <span aria-hidden>·</span>
                  <span className="truncate">{a.mimeType}</span>
                  <span aria-hidden>·</span>
                  <RelativeTime date={a.createdAt} />
                  {a.uploader && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="inline-flex items-center gap-1">
                        <UserAvatar
                          name={a.uploader.name}
                          color={a.uploader.avatarColor}
                          size="sm"
                        />
                        <span className="truncate max-w-[10rem]">{a.uploader.name}</span>
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
                      <a href={a.url} download={a.fileName} target="_blank" rel="noreferrer">
                        <Download className="size-3.5" />
                        <span className="sr-only">Download {a.fileName}</span>
                      </a>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Download</TooltipContent>
                </Tooltip>
                {canDelete(a) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
                        onClick={() => {
                          if (confirm(`Delete attachment "${a.fileName}"?`)) {
                            deleteMutation.mutate(a.id);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="size-3.5" />
                        <span className="sr-only">Delete {a.fileName}</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default AttachmentList;
