/**
 * modules/policies-compliance/components/PolicyAlertMarketplaceList.tsx
 *
 * Renders the list of marketplace statuses for a single grouped alert.
 * Receives marketplace_statuses[] directly from the backend DTO and shows each one.
 * No grouping. No deduplication. No state inference.
 */

import type { PolicyAlertMarketplaceStatus } from "../types/policyCompliance.types";
import { PolicyAlertStatusBadge } from "./PolicyAlertStatusBadge";

export function PolicyAlertMarketplaceList({
  statuses,
}: {
  statuses: PolicyAlertMarketplaceStatus[];
}) {
  if (statuses.length === 0) {
    return <span className="text-xs text-slate-400">—</span>;
  }

  return (
    <ul className="space-y-1">
      {statuses.map((ms) => (
        <li
          key={ms.alert_id}
          className="flex items-center gap-1.5 text-xs text-slate-700"
        >
          <span className="font-medium w-7 shrink-0">{ms.country_code}</span>
          <PolicyAlertStatusBadge status={ms.status} />
        </li>
      ))}
    </ul>
  );
}
