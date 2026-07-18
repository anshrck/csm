'use client';

import * as React from 'react';
import { ShieldAlert } from 'lucide-react';
import { FormattedDate } from '@/components/shared';
import {
  OwnerDecisionDialog,
  type DecisionOption,
} from './OwnerDecisionDialog';

/**
 * BreachResponseDialog — specialised OwnerDecisionDialog for BREACH_RESPONSE.
 *
 * Decision options (locked per the API contract):
 *   - REMEDIATION_AUTHORIZED
 *   - RESOURCES_AUTHORIZED
 *   - EMERGENCY_CHANGE_DIRECTED
 *
 * Renders a rose-tinted breach context panel at the top of the dialog so the
 * owner can see exactly which service + SLA event they are responding to
 * before committing the decision.
 */

const BREACH_DECISION_OPTIONS: DecisionOption[] = [
  { value: 'REMEDIATION_AUTHORIZED', label: 'Remediation Authorized' },
  { value: 'RESOURCES_AUTHORIZED', label: 'Resources Authorized' },
  { value: 'EMERGENCY_CHANGE_DIRECTED', label: 'Emergency Change Directed' },
];

export interface BreachResponseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceId: string;
  slaEventId: string;
  serviceName: string;
  breachMessage?: string;
  breachDate?: string;
  onSubmitted?: (decision: string) => void;
}

export function BreachResponseDialog({
  open,
  onOpenChange,
  serviceId,
  slaEventId,
  serviceName,
  breachMessage,
  breachDate,
  onSubmitted,
}: BreachResponseDialogProps) {
  return (
    <OwnerDecisionDialog
      open={open}
      onOpenChange={onOpenChange}
      serviceId={serviceId}
      slaEventId={slaEventId}
      decisionType="BREACH_RESPONSE"
      decisionOptions={BREACH_DECISION_OPTIONS}
      dialogTitle="Record Breach Response"
      dialogDescription={
        <span>
          A breach notification is an accountability event. Your response is
          persisted to the audit trail and CM Leaders are notified
          automatically.
        </span>
      }
      onSubmitted={onSubmitted}
    />
  );
}

/**
 * BreachContextPanel — renders the breach metadata at the top of a custom
 * dialog body. Exported separately so callers that compose their own dialog
 * can reuse the visual treatment.
 */
export function BreachContextPanel({
  serviceName,
  breachMessage,
  breachDate,
}: {
  serviceName: string;
  breachMessage?: string;
  breachDate?: string;
}) {
  return (
    <div className="rounded-md border border-rose-200 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-950/20 p-3 text-xs space-y-1">
      <div className="flex items-center gap-1.5 font-semibold text-rose-800 dark:text-rose-300">
        <ShieldAlert className="h-3.5 w-3.5" />
        {serviceName}
      </div>
      {breachMessage && (
        <p className="text-rose-900/80 dark:text-rose-200/80 leading-relaxed">
          {breachMessage}
        </p>
      )}
      {breachDate && (
        <p className="text-muted-foreground">
          Detected <FormattedDate date={breachDate} />
        </p>
      )}
    </div>
  );
}

export default BreachResponseDialog;
