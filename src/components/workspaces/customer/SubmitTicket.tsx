'use client';

/**
 * SubmitTicket — customer-facing form to raise a new ticket/case.
 *
 * Fields: title, description, type (INCIDENT/SERVICE_REQUEST/QUESTION/COMPLAINT),
 * suggested priority (P1-P4; the actual priority is set during triage), and
 * serviceId (chosen from the customer's entitled services).
 *
 * On submit → POST /api/tickets. Success → navigate('ticket-detail', { id }).
 *
 * The customer's orgNode is set server-side from the session — they cannot
 * raise tickets on behalf of another org.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Ticket as TicketIcon,
  Send,
  X,
  AlertCircle,
  Loader2,
  Info,
  PlusCircle,
} from 'lucide-react';

import { useApp } from '@/lib/store';
import { apiGet, apiPost } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { type Service } from '@/lib/types';
import {
  type TicketType,
  type TicketPriority,
  TICKET_TYPE_LABELS,
  TICKET_PRIORITY_LABELS,
} from '@/lib/tickets';
import {
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingState,
  Button,
  Badge,
  SlaClassBadge,
} from '@/components/shared';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const TYPE_OPTIONS: { value: TicketType; label: string; hint: string }[] = [
  { value: 'INCIDENT', label: 'Incident', hint: 'Something is broken or unavailable.' },
  { value: 'SERVICE_REQUEST', label: 'Service Request', hint: 'Ask for something new — access, provisioning, advice.' },
  { value: 'QUESTION', label: 'Question', hint: 'How-to or clarification.' },
  { value: 'COMPLAINT', label: 'Complaint', hint: 'Dissatisfaction with service delivery.' },
];

const PRIORITY_OPTIONS: { value: TicketPriority; label: string; hint: string }[] = [
  { value: 'P1', label: 'P1 — Critical', hint: 'Total outage, business stopped.' },
  { value: 'P2', label: 'P2 — High', hint: 'Significant degradation, no workaround.' },
  { value: 'P3', label: 'P3 — Medium', hint: 'Limited impact, workaround available.' },
  { value: 'P4', label: 'P4 — Low', hint: 'Minor inconvenience or general request.' },
];

export default function SubmitTicket() {
  const { navigate, session } = useApp();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<TicketType>('INCIDENT');
  const [suggestedPriority, setSuggestedPriority] = useState<TicketPriority>('P3');
  const [serviceId, setServiceId] = useState<string>('__none');
  const [touched, setTouched] = useState(false);

  // Fetch the customer's entitled services so they can pick a service context.
  const servicesQ = useQuery<Service[]>({
    queryKey: ['services', 'entitled', 'submit-ticket'],
    queryFn: () => apiGet<Service[]>('/api/services?entitled=1'),
    staleTime: 60_000,
  });

  const services = servicesQ.data ?? [];
  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId],
  );

  const createMut = useMutation({
    mutationFn: (payload: {
      title: string;
      description: string;
      type: TicketType;
      priority: TicketPriority;
      serviceId: string | null;
    }) =>
      apiPost<{ id: string; number: string }>('/api/tickets', {
        ...payload,
        // The server stores the suggested priority on the ticket row at create
        // time. Real priority is set during triage (PATCH /api/tickets/[id]/triage).
        // For a customer-submitted ticket we honour the suggested value but
        // surface a note telling them it may change.
      }),
    onSuccess: (t) => {
      toast.success(`Ticket ${t.number} created`, {
        description: 'Your case has been queued for triage. The team will be in touch shortly.',
      });
      navigate('ticket-detail', { id: t.id });
    },
    onError: (e: Error) =>
      toast.error('Could not submit ticket', { description: e.message }),
  });

  const titleErr = touched && !title.trim() ? 'Title is required' : '';
  const descErr = touched && !description.trim() ? 'Description is required' : '';
  const canSubmit =
    title.trim().length > 0 && description.trim().length > 0 && !createMut.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    createMut.mutate({
      title: title.trim(),
      description: description.trim(),
      type,
      priority: suggestedPriority,
      serviceId: serviceId === '__none' ? null : serviceId,
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Submit a Ticket"
        description="Raise a new case — an incident, service request, question, or complaint. An SCM Worker will triage and assign it during business hours."
        icon={<PlusCircle className="h-5 w-5" />}
        actions={
          <Button
            variant="outline"
            onClick={() => navigate('tickets')}
            className="gap-1.5"
          >
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
        }
      />

      {!session?.orgNodeId && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Your account has no customer organisation attached. Please contact your
            administrator — tickets cannot be raised without an orgNode.
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <SectionCard
          title="Case details"
          description="Tell us what's happening. The clearer the description, the faster we can resolve it."
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">
                Title <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="title"
                placeholder="e.g. ERP login page returns 500 error for all users"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                aria-invalid={!!titleErr}
              />
              {titleErr ? (
                <p className="text-xs text-rose-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {titleErr}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  A short, descriptive headline for your case.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">
                Description <span className="text-rose-600">*</span>
              </Label>
              <Textarea
                id="description"
                placeholder={
                  'Describe the situation in detail.\n\nInclude:\n• What you were doing when the issue occurred\n• Any error messages you saw\n• Steps to reproduce (if applicable)\n• Business impact — who/what is affected'
                }
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={8}
                aria-invalid={!!descErr}
              />
              {descErr ? (
                <p className="text-xs text-rose-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {descErr}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  The richer your description, the faster we can triage and resolve.
                </p>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Classification"
          description="Your suggestions help us route the case; the SCM team will confirm priority during triage."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="type">Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as TicketType)}
              >
                <SelectTrigger id="type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {TYPE_OPTIONS.find((t) => t.value === type)?.hint}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="priority">Suggested priority</Label>
              <Select
                value={suggestedPriority}
                onValueChange={(v) => setSuggestedPriority(v as TicketPriority)}
              >
                <SelectTrigger id="priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {PRIORITY_OPTIONS.find((p) => p.value === suggestedPriority)?.hint}
                {' '}
                The actual priority is set during triage.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-1.5">
            <Label htmlFor="service">Affected service (optional)</Label>
            {servicesQ.isLoading ? (
              <LoadingState rows={1} />
            ) : services.length === 0 ? (
              <EmptyState
                icon={<TicketIcon className="h-6 w-6 text-muted-foreground/50" />}
                title="No entitled services"
                description="Your organisation has no active service entitlements. You can still submit the case without a service link — the team will route it."
              />
            ) : (
              <>
                <Select value={serviceId} onValueChange={setServiceId}>
                  <SelectTrigger id="service" className="w-full">
                    <SelectValue placeholder="Choose a service…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">No specific service</SelectItem>
                    {services.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="flex items-center gap-2">
                          <span>{s.name}</span>
                          <SlaClassBadge slaClass={s.slaClass} className="text-[10px] h-4 px-1" />
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedService && (
                  <p className="text-[11px] text-muted-foreground">
                    Linking to <strong>{selectedService.name}</strong> means the
                    matching SLA policy applies once the ticket is triaged.
                  </p>
                )}
              </>
            )}
          </div>
        </SectionCard>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>What happens next?</strong> Your case is queued as <Badge variant="outline" className="ml-1 text-[10px]">NEW</Badge>
            and an SCM Worker will triage it — confirming priority, impact, and urgency — before
            work begins. You'll receive a notification when the status changes. You can track
            progress and add comments from the ticket detail page.
          </AlertDescription>
        </Alert>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate('tickets')}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit} className="gap-2">
            {createMut.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
              </>
            ) : (
              <>
                <Send className="h-4 w-4" /> Submit Ticket
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
