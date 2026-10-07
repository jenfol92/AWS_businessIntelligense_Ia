/**
 * modules/policies-compliance/components/PolicyAlertStatusBadge.tsx
 *
 * Renders a coloured pill for a given PolicyAlertStatus.
 * Reads colour and label from policyAlertConstants; no logic here.
 */

import type { PolicyAlertStatus } from "../types/policyCompliance.types";
import { STATUS_BADGE } from "./policyAlertConstants";

export function PolicyAlertStatusBadge({ status }: { status: PolicyAlertStatus }) {
  const { label, className } = STATUS_BADGE[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${className}`}
    >
      {label}
    </span>
  );
}
