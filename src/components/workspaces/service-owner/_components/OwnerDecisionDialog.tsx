'use client';

import * as React from 'react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiPost } from '@/lib/api';
import { Button } from '@/components/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar as CalendarIcon, Gavel, Clock, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * OwnerDecisionDialog — reusable dialog for recording governance decisions.
 *
 * Wraps POST /api/governance-decisions with the full field set:
 *   - decisionType (constant per dialog instance)
 *   - decision (select from supplied options)
 *   - rationale (required textarea)
 *   - resourcesAuthorized (optional text input)
 *   - followUpOwner (optional text input)
 *   - followUpDate (optional date picker)
 *
 * The parent supplies the decisionType + decisionOptions so the same dialog
 * can serve COMMITMENT_APPROVAL, BREACH_RESPONSE, LIFECYCLE_DIRECTION, etc.
 */
export interface DecisionOption {
  value: string;
  label: string;
}

export interface OwnerDecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceId: string;
  demandId?: string;
  slaEventId?: string;
  problemId?: string;
  decisionType:
    | 'COMMITMENT_APPROVAL'
    | 'COMMITMENT_ESCALATION'
    | 'BREACH_RESPONSE'
    | 'LIFECYCLE_DIRECTION'
    | 'CATALOG_ACCURACY'
    | 'KNOWLEDGE_APPROVAL'
    | 'CUSTOMER_RISK_ESCALATION'
    | 'REMEDIATION_AUTHORIZATION'
    | 'POST_IMPLEMENTATION_REVIEW';
  decisionOptions: DecisionOption[];
  dialogTitle?: string;
  dialogDescription?: React.ReactNode;
  onSubmitted?: (decision: string) => void;
}

export function OwnerDecisionDialog({
  open,
  onOpenChange,
  serviceId,
  demandId,
  slaEventId,
  problemId,
  decisionType,
  decisionOptions,
  dialogTitle = 'Record Governance Decision',
  dialogDescription,
  onSubmitted,
}: OwnerDecisionDialogProps) {
  const qc = useQueryClient();
  const [decision, setDecision] = useState<string>('');
  const [rationale, setRationale] = useState('');
  const [resourcesAuthorized, setResourcesAuthorized] = useState('');
  const [followUpOwner, setFollowUpOwner] = useState('');
  const [followUpDate, setFollowUpDate] = useState<Date | undefined>(undefined);

  // Reset form whenever the dialog closes.
  React.useEffect(() => {
    if (!open) {
      setDecision('');
      setRationale('');
      setResourcesAuthorized('');
      setFollowUpOwner('');
      setFollowUpDate(undefined);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: (payload: {
      serviceId: string;
      demandId?: string;
      slaEventId?: string;
      problemId?: string;
      decisionType: string;
      decision: string;
      rationale: string;
      resourcesAuthorized?: string;
      followUpOwner?: string;
      followUpDate?: string;
    }) => apiPost('/api/governance-decisions', payload),
    onSuccess: (_data, vars) => {
      toast.success('Governance decision recorded', {
        description: `Decision "${vars.decision}" persisted to the audit trail.`,
      });
      qc.invalidateQueries({ queryKey: ['governance-decisions'] });
      onSubmitted?.(vars.decision);
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast.error('Could not record decision', { description: e.message }),
  });

  const canSubmit =
    !!decision && rationale.trim().length > 0 && !mutation.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    mutation.mutate({
      serviceId,
      demandId,
      slaEventId,
      problemId,
      decisionType,
      decision,
      rationale: rationale.trim(),
      resourcesAuthorized: resourcesAuthorized.trim() || undefined,
      followUpOwner: followUpOwner.trim() || undefined,
      followUpDate: followUpDate ? followUpDate.toISOString() : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gavel className="h-5 w-5 text-primary" />
            {dialogTitle}
          </DialogTitle>
          <DialogDescription>
            {dialogDescription ??
              'Record your governance decision. The rationale is required and is persisted to the audit trail; CM Leaders are notified for breach responses and escalations.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="od-decision">Decision (required)</Label>
            <Select value={decision} onValueChange={setDecision}>
              <SelectTrigger id="od-decision" className="w-full">
                <SelectValue placeholder="Select a decision…" />
              </SelectTrigger>
              <SelectContent>
                {decisionOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="od-rationale">Rationale (required)</Label>
            <Textarea
              id="od-rationale"
              rows={4}
              placeholder="Explain the governance context, the trade-off considered, and why this is the right accountability decision."
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="od-resources">Resources authorized (optional)</Label>
            <Input
              id="od-resources"
              placeholder="e.g. 2 FTE for 5 days, $25k remediation budget"
              value={resourcesAuthorized}
              onChange={(e) => setResourcesAuthorized(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="od-followup-owner">Follow-up owner (optional)</Label>
              <Input
                id="od-followup-owner"
                placeholder="Name or role"
                value={followUpOwner}
                onChange={(e) => setFollowUpOwner(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="od-followup-date">Follow-up date (optional)</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="od-followup-date"
                    variant="outline"
                    role="combobox"
                    className={cn(
                      'w-full justify-start text-left font-normal h-9',
                      !followUpDate && 'text-muted-foreground',
                    )}
                  >
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                    {followUpDate
                      ? followUpDate.toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                      : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={followUpDate}
                    onSelect={setFollowUpDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {mutation.isPending ? (
              <>
                <Clock className="h-4 w-4 animate-pulse mr-1.5" />
                Recording…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                Record Decision
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OwnerDecisionDialog;
