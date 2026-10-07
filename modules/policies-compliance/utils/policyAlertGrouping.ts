/**
 * modules/policies-compliance/utils/policyAlertGrouping.ts
 *
 * Groups flat PolicyAlert rows by (asin, sku, category, type) and
 * enriches each group with all marketplace/country statuses.
 *
 * This is the sole place where aggregation happens.
 * The UI receives GroupedPolicyAlert[] and never calculates its own merges.
 */

import type {
  GroupedPolicyAlert,
  PolicyAlert,
  PolicyAlertMarketplaceStatus,
  PolicyAlertStatus,
} from "../types/policyCompliance.types";

/** Derived here to keep this file self-contained and Node-test-friendly. */
export function resolvePolicyAlertStatus(
  alert: Pick<PolicyAlert, "still_in_amazon" | "last_checked_at" | "resolved_at">,
): PolicyAlertStatus {
  if (alert.resolved_at != null || !alert.still_in_amazon) return "resolved";
  if (alert.last_checked_at == null) return "pending_review";
  return "active";
}

type GroupKey = string;

function makeGroupKey(alert: PolicyAlert): GroupKey {
  return `${alert.asin}|${alert.sku}|${alert.category}|${alert.type}`;
}

/**
 * Groups an array of flat PolicyAlert rows into aggregated GroupedPolicyAlert records.
 * Within each group, all marketplace instances are listed in marketplace_statuses.
 * The earliest created_at across the group is used as the group's created_at.
 */
export function groupPolicyAlerts(alerts: PolicyAlert[]): GroupedPolicyAlert[] {
  const groups = new Map<GroupKey, PolicyAlert[]>();

  for (const alert of alerts) {
    const key = makeGroupKey(alert);
    const existing = groups.get(key);
    if (existing) {
      existing.push(alert);
    } else {
      groups.set(key, [alert]);
    }
  }

  return Array.from(groups.values()).map((group) => {
    // Sort by created_at ascending so the earliest record is [0]
    const sorted = group.slice().sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    const representative = sorted[0];

    const marketplaceStatuses: PolicyAlertMarketplaceStatus[] = group.map((a) => ({
      marketplace_id: a.marketplace_id,
      country_code: a.country_code,
      status: resolvePolicyAlertStatus(a),
      alert_id: a.id,
      last_checked_at: a.last_checked_at,
      resolved_at: a.resolved_at,
    }));

    // Deduplicate countries and marketplaces preserving insertion order
    const countries = Array.from(
      new Set(group.map((a) => a.country_code).filter(Boolean)),
    );
    const marketplaces = Array.from(
      new Set(group.map((a) => a.marketplace_id).filter(Boolean)),
    );

    return {
      asin: representative.asin,
      sku: representative.sku,
      category: representative.category,
      type: representative.type,
      description: representative.description,
      product_title: representative.product_title,
      product_image_url: representative.product_image_url,
      product_brand: representative.product_brand,
      created_at: representative.created_at,
      countries,
      marketplaces,
      marketplace_statuses: marketplaceStatuses,
    } satisfies GroupedPolicyAlert;
  });
}
