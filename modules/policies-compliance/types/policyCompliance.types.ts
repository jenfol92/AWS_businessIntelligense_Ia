/**
 * modules/policies-compliance/types/policyCompliance.types.ts
 *
 * Canonical types for the policies-compliance module.
 * All SP-API data is source-attributed and never silently coerced.
 *
 * Design guardrails applied:
 *   - §2.1 Data minimization: only fields required for compliance tracking are stored.
 *   - §9 Data origin: every alert carries its source_event for auditability.
 *   - §2.3 State separation: alert status is explicit ("active" | "resolved" | "pending_review").
 */

// ─── Database row (matches product_policy_alerts table) ─────────────────────

export type PolicyAlert = {
  id: string;
  asin: string;
  sku: string;
  marketplace_id: string;
  country_code: string;
  category: string;
  type: string;
  description: string | null;
  still_in_amazon: boolean;
  last_checked_at: string | null;
  created_at: string;
  resolved_at: string | null;
  product_title: string | null;
  product_image_url: string | null;
  product_brand: string | null;
  source_event: unknown | null;
};

export type PolicyAlertInsert = Omit<PolicyAlert, "id" | "created_at"> & {
  created_at?: string;
};

export type PolicyAlertUpdate = Partial<
  Pick<
    PolicyAlert,
    | "still_in_amazon"
    | "last_checked_at"
    | "resolved_at"
    | "description"
    | "product_title"
    | "product_image_url"
    | "product_brand"
    | "source_event"
  >
>;

// ─── Alert status for UI ─────────────────────────────────────────────────────

export type PolicyAlertStatus = "active" | "resolved" | "pending_review";

export function resolvePolicyAlertStatus(alert: Pick<PolicyAlert, "still_in_amazon" | "last_checked_at" | "resolved_at">): PolicyAlertStatus {
  if (alert.resolved_at != null || !alert.still_in_amazon) return "resolved";
  if (alert.last_checked_at == null) return "pending_review";
  return "active";
}

// ─── Grouped / aggregated view for the UI ────────────────────────────────────

export type PolicyAlertMarketplaceStatus = {
  marketplace_id: string;
  country_code: string;
  status: PolicyAlertStatus;
  alert_id: string;
  last_checked_at: string | null;
  resolved_at: string | null;
};

/**
 * Aggregated alert grouped by (asin, sku, category, type).
 * The backend resolves all marketplace instances into one record.
 * The UI only renders this shape.
 */
export type GroupedPolicyAlert = {
  asin: string;
  sku: string;
  category: string;
  type: string;
  description: string | null;
  product_title: string | null;
  product_image_url: string | null;
  product_brand: string | null;
  created_at: string;
  countries: string[];
  marketplaces: string[];
  marketplace_statuses: PolicyAlertMarketplaceStatus[];
};

// ─── SP-API notification event shapes ────────────────────────────────────────

/**
 * Union of the three SP-API notification types this module handles.
 * Amazon docs: Notifications API → LISTINGS_ITEM_ISSUES,
 *              LISTINGS_DEFECT_NOTIFICATIONS, LISTINGS_QUALITY_NOTIFICATIONS
 */
export type PolicyNotificationType =
  | "LISTINGS_ITEM_ISSUES"
  | "LISTINGS_DEFECT_NOTIFICATIONS"
  | "LISTINGS_QUALITY_NOTIFICATIONS";

export type AmazonIssue = {
  code?: string;
  message?: string;
  severity?: string;
  attributeName?: string;
  categories?: string[];
};

export type PolicyIssueEvent = {
  notificationType: PolicyNotificationType;
  notificationVersion?: string;
  eventTime?: string;
  payload?: {
    itemIssues?: {
      sku?: string;
      asin?: string;
      marketplaceId?: string;
      issues?: AmazonIssue[];
    };
    listingDefect?: {
      sku?: string;
      asin?: string;
      marketplaceId?: string;
      defectType?: string;
      defectDescription?: string;
      affectedCategory?: string;
    };
    listingQuality?: {
      sku?: string;
      asin?: string;
      marketplaceId?: string;
      qualityType?: string;
      qualityDescription?: string;
      affectedCategory?: string;
    };
  };
};

// ─── Catalog Items API response ───────────────────────────────────────────────

export type AmazonCatalogItemSummary = {
  asin: string;
  title?: string;
  brand?: string;
  mainImageUrl?: string;
};
