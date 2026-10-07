/**
 * modules/policies-compliance/services/policyComplianceService.ts
 *
 * Core orchestration layer for policy alerts.
 *
 * Responsibilities:
 *   1. registerAlert()     — process a raw SP-API notification event
 *   2. getAlertsByAsin()   — read + group by asin
 *   3. getAllGrouped()      — read all + group
 *   4. markAsResolved()    — internal/manual resolution
 *   5. syncWithAmazon()    — cron-driven sync: check each active alert via SP-API
 *   6. fetchAndEnrichCatalogData() — enrich alerts with product metadata
 *
 * Guardrails:
 *   - §3: SP-API calls are in syncWithAmazon(); no direct call on every HTTP request.
 *   - §3: Throttle: 500 ms delay between Amazon calls in sync loop.
 *   - §13: No write coercion; Amazon unavailability does NOT corrupt persisted data.
 *   - §2.4: sync reports how many alerts were checked and how many resolved.
 *   - Phase 0: automatic resolution is disabled until legacy identity is validated.
 */

import { getListingIssues } from "@/modules/amazon-sp-api/listingsItemsClient";
import {
  listActivePolicyAlerts,
  listAllPolicyAlerts,
  listPolicyAlertsByAsin,
  markAlertResolvedInternally,
  updateAlertSyncState,
  upsertPolicyAlert,
} from "../repositories/policyAlertsRepository";
import { fetchCatalogItem } from "./catalogItemsClient";
import { mapNotificationToAlerts } from "../utils/mapNotificationToAlert";
import { groupPolicyAlerts } from "../utils/policyAlertGrouping";
import type {
  GroupedPolicyAlert,
  PolicyAlert,
  PolicyAlertInsert,
} from "../types/policyCompliance.types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Public service functions ─────────────────────────────────────────────────

/**
 * Processes a raw SP-API notification event.
 * Maps it to one or more alert records and upserts each one idempotently.
 * Returns the list of persisted alerts.
 */
export async function registerAlert(event: unknown): Promise<PolicyAlert[]> {
  const inserts: PolicyAlertInsert[] = mapNotificationToAlerts(event);

  if (inserts.length === 0) {
    return [];
  }

  const results: PolicyAlert[] = [];
  for (const insert of inserts) {
    const saved = await upsertPolicyAlert(insert);
    results.push(saved);
  }
  return results;
}

/**
 * Returns all policy alerts for a given ASIN, grouped by (sku, category, type) × marketplace.
 */
export async function getAlertsByAsin(asin: string): Promise<GroupedPolicyAlert[]> {
  const alerts = await listPolicyAlertsByAsin(asin);
  return groupPolicyAlerts(alerts);
}

/**
 * Returns all policy alerts grouped by (asin, sku, category, type).
 */
export async function getAllGrouped(): Promise<GroupedPolicyAlert[]> {
  const alerts = await listAllPolicyAlerts();
  return groupPolicyAlerts(alerts);
}

/**
 * Manual resolution is blocked in Phase 0: internal actions cannot assert
 * that an issue has disappeared from Amazon.
 */
export async function markAsResolved(alertId: string): Promise<PolicyAlert> {
  return markAlertResolvedInternally(alertId);
}

export type SyncWithAmazonResult = {
  checked: number;
  resolved: number;
  errors: number;
  unconfirmed: number;
  skippedNoSellerId: boolean;
};

/**
 * Phase 0 containment of the existing sync, not a new reconciliation engine.
 * Listings issues are observed listing problems, never proof of legal compliance.
 * Legacy alert identity/source is not validated yet: absence cannot close a row.
 * Failed/unknown observations do not update last_checked_at.
 * Keep the existing 500 ms pacing; no additional retry loop is introduced.
 */
export async function syncWithAmazon(): Promise<SyncWithAmazonResult> {
  const sellerId = process.env.AMAZON_SELLER_ID?.trim();
  if (!sellerId) {
    return { checked: 0, resolved: 0, errors: 0, unconfirmed: 0, skippedNoSellerId: true };
  }

  const activeAlerts = await listActivePolicyAlerts();
  let checked = 0;
  let errors = 0;
  let unconfirmed = 0;
  for (const alert of activeAlerts) {
    await sleep(500);
    const observation = await getListingIssues({
      sellerSku: alert.sku,
      marketplaceId: alert.marketplace_id,
      signal: AbortSignal.timeout(20_000),
    });
    if (observation.status !== "SUCCESS") {
      errors += 1;
      continue;
    }
    checked += 1;
    // Positive matching retains the existing semantics; it does not define a new
    // UNIQUE key. No negative match, including explicit [], closes a legacy row.
    const stillPresent = observation.issues.some((issue) =>
      issue.code === alert.type &&
      (issue.categories.includes(alert.category) || issue.severity === alert.category));
    if (!stillPresent) {
      unconfirmed += 1;
      continue;
    }
    await updateAlertSyncState(alert.id, {
      stillInAmazon: true,
      checkedAt: observation.checkedAt,
    });
  }
  return { checked, resolved: 0, errors, unconfirmed, skippedNoSellerId: false };
}

/**
 * Fetches and stores Catalog Items metadata (title, image, brand) for a given ASIN.
 * Updates all alert rows sharing the same ASIN.
 * Returns the catalog metadata or null if unavailable.
 */
export async function fetchAndEnrichCatalogData(
  asin: string,
  marketplaceIds: string[],
): Promise<{ title: string | null; imageUrl: string | null; brand: string | null }> {
  const item = await fetchCatalogItem(asin, marketplaceIds);

  if (!item) {
    return { title: null, imageUrl: null, brand: null };
  }

  // Update all rows for this ASIN with the enriched product data
  const { supabaseAdmin } = await import("@/server/supabase/adminClient");
  const { error } = await supabaseAdmin
    .from("product_policy_alerts")
    .update({
      product_title: item.title ?? null,
      product_image_url: item.mainImageUrl ?? null,
      product_brand: item.brand ?? null,
    })
    .eq("asin", asin);

  if (error) {
    console.error(`[PolicyCompliance] Failed to enrich catalog data for ${asin}:`, error.message);
  }

  return {
    title: item.title ?? null,
    imageUrl: item.mainImageUrl ?? null,
    brand: item.brand ?? null,
  };
}
