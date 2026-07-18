'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  PlusCircle,
  X,
  Send,
  AlertCircle,
  Loader2,
  Library,
  Info,
} from 'lucide-react';
import { useApp } from '@/lib/store';
import { apiGet, apiPost } from '@/lib/api';
import { type Service, type Demand } from '@/lib/types';
import {
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingState,
  Button,
  SlaClassBadge,
  Badge,
} from '@/components/shared';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';

export default function SubmitDemand() {
  const { params, navigate } = useApp();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [businessJustification, setBusinessJustification] = useState('');
  const [desiredTimeline, setDesiredTimeline] = useState('');
  // Pre-select service if arrived from catalog "Submit Demand for This Service".
  // Lazy init — the component remounts each time the user navigates here from the catalog.
  const [relatedServiceIds, setRelatedServiceIds] = useState<string[]>(() =>
    params.serviceId ? [params.serviceId] : [],
  );
  const [touched, setTouched] = useState(false);

  const servicesQ = useQuery({
    queryKey: ['services', 'entitled'],
    queryFn: () => apiGet<Service[]>('/api/services?entitled=1'),
  });

  const services = servicesQ.data ?? [];

  const createMut = useMutation({
    mutationFn: (payload: {
      title: string;
      description: string;
      businessJustification?: string;
      desiredTimeline?: string;
      relatedServiceIds: string[];
    }) => apiPost<Demand>('/api/demands', payload),
    onSuccess: (d) => {
      toast.success('Demand submitted', {
        description: 'A Service Customer Manager will be assigned shortly. You can track progress under My Demands.',
      });
      navigate('demand-detail', { id: d.id });
    },
    onError: (e: Error) => toast.error('Could not submit demand', { description: e.message }),
  });

  const availableToAdd = useMemo(
    () => services.filter((s) => !relatedServiceIds.includes(s.id)),
    [services, relatedServiceIds],
  );

  const selectedServices = useMemo(
    () => relatedServiceIds.map((id) => services.find((s) => s.id === id)).filter((s): s is Service => !!s),
    [relatedServiceIds, services],
  );

  function addService(id: string) {
    if (!relatedServiceIds.includes(id)) setRelatedServiceIds((prev) => [...prev, id]);
  }
  function removeService(id: string) {
    setRelatedServiceIds((prev) => prev.filter((x) => x !== id));
  }

  const titleErr = touched && !title.trim() ? 'Title is required' : '';
  const descErr = touched && !description.trim() ? 'Description is required' : '';
  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && !createMut.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    createMut.mutate({
      title: title.trim(),
      description: description.trim(),
      businessJustification: businessJustification.trim() || undefined,
      desiredTimeline: desiredTimeline.trim() || undefined,
      relatedServiceIds,
    });
  }

  const preselectedName = params.serviceId
    ? services.find((s) => s.id === params.serviceId)?.name
    : undefined;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Submit a Demand"
        description="Submit a new service demand to the SCM team for assessment and quoting."
        icon={<PlusCircle className="h-5 w-5" />}
        actions={
          <Button variant="outline" onClick={() => navigate('dashboard')} className="gap-1.5">
            Cancel
          </Button>
        }
      />

      {preselectedName && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Pre-selected service: <strong>{preselectedName}</strong>. You can adjust the related services below.
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <SectionCard title="Demand details" description="Tell us what you need and why.">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">
                Title <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="title"
                placeholder="e.g. Procurement self-service portal module"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={140}
                aria-invalid={!!titleErr}
              />
              {titleErr ? (
                <p className="text-xs text-rose-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {titleErr}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">A short, descriptive headline for your demand.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">
                Description <span className="text-rose-600">*</span>
              </Label>
              <Textarea
                id="description"
                placeholder="Describe what you need in detail — the capabilities, the users, the expected outcome."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                aria-invalid={!!descErr}
              />
              {descErr ? (
                <p className="text-xs text-rose-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {descErr}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Be specific — this guides the SCM assessment and quote.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="justification">Business Justification (optional)</Label>
              <Textarea
                id="justification"
                placeholder="Why this matters — regulatory drivers, efficiency gains, audit findings, strategic alignment."
                value={businessJustification}
                onChange={(e) => setBusinessJustification(e.target.value)}
                rows={4}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="timeline">Desired Timeline (optional)</Label>
              <Input
                id="timeline"
                placeholder="e.g. Before Q3 budget cycle"
                value={desiredTimeline}
                onChange={(e) => setDesiredTimeline(e.target.value)}
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Related services"
          description="Optionally link one or more catalog services this demand concerns."
          actions={<Badge variant="outline" className="gap-1"><Library className="h-3 w-3" /> {selectedServices.length}</Badge>}
        >
          {servicesQ.isLoading ? (
            <LoadingState rows={3} />
          ) : services.length === 0 ? (
            <EmptyState
              icon={<Library className="h-8 w-8" />}
              title="No entitled services"
              description="Your organisation has no active service entitlements to link."
            />
          ) : (
            <div className="space-y-3">
              {selectedServices.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedServices.map((s) => (
                    <span
                      key={s.id}
                      className="inline-flex items-center gap-1.5 rounded-md border bg-primary/5 border-primary/30 px-2 py-1 text-xs"
                    >
                      <span className="font-medium">{s.name}</span>
                      <SlaClassBadge slaClass={s.slaClass} className="text-[10px] h-4 px-1" />
                      <button
                        type="button"
                        onClick={() => removeService(s.id)}
                        className="ml-0.5 text-muted-foreground hover:text-rose-600"
                        aria-label={`Remove ${s.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {availableToAdd.length > 0 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="svc-add" className="text-xs text-muted-foreground">
                    Add a service
                  </Label>
                  <Select onValueChange={(v) => { addService(v); }}>
                    <SelectTrigger id="svc-add" className="w-full">
                      <SelectValue placeholder="Choose a service to link…" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableToAdd.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          <span className="flex items-center gap-2">
                            <span>{s.name}</span>
                            <Badge variant="outline" className="text-[10px] h-4 px-1">Class {s.slaClass}</Badge>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">All entitled services have been added.</p>
              )}
            </div>
          )}
        </SectionCard>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate('dashboard')}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit} className="gap-2">
            {createMut.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
              </>
            ) : (
              <>
                <Send className="h-4 w-4" /> Submit Demand
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
