/**
 * modules/policies-compliance/utils/mapNotificationToAlert.ts
 *
 * Transforms raw SP-API notification payloads into normalized PolicyAlertInsert records.
 *
 * Handles three notification types:
 *   - LISTINGS_ITEM_ISSUES
 *   - LISTINGS_DEFECT_NOTIFICATIONS
 *   - LISTINGS_QUALITY_NOTIFICATIONS
 *
 * Guardrails:
 *   - §13: never silently coerce unexpected payloads. Returns null for invalid events.
 *   - §2.1: only maps fields needed for storage; no PII extracted.
 *   - §9: source_event is stored verbatim for audit.
 */

import type {
  PolicyAlertInsert,
  PolicyIssueEvent,
} from "../types/policyCompliance.types";

// Marketplace ID → country code map (covers all EU marketplaces in the project)
const MARKETPLACE_TO_COUNTRY: Record<string, string> = {
  A1RKKUPIHCS9HS: "ES",
  A13V1IB3VIYZZH: "FR",
  A1PA6795UKMFR9: "DE",
  APJ6JRA9NG5V4: "IT",
  A1F83G8C2ARO7P: "GB",
  AMEN7PMS3EDWL: "BE",
  A1805IZSGTT6HS: "NL",
  A2NODRKZP88ZB9: "SE",
  A1C3SOZRARQ6R3: "PL",
  A28R8C7NBKEWEA: "IE",
  A2VIGQ35RCS4UG: "AE",
  A17E79C6D8DWNP: "SA",
};

function resolveCountryFromMarketplace(marketplaceId: string): string {
  return MARKETPLACE_TO_COUNTRY[marketplaceId] ?? marketplaceId;
}

// ─── Mappers per notification type ───────────────────────────────────────────

function mapListingsItemIssues(
  event: PolicyIssueEvent,
): PolicyAlertInsert[] | null {
  const payload = event.payload?.itemIssues;
  if (!payload?.sku || !payload.asin || !payload.marketplaceId) return null;

  const issues = payload.issues ?? [];
  if (issues.length === 0) return null;

  const marketplaceId = payload.marketplaceId;
  const countryCode = resolveCountryFromMarketplace(marketplaceId);

  return issues.map((issue) => {
    const category =
      issue.categories?.[0] ?? issue.severity ?? "Unknown";
    const type = issue.code ?? "Unknown";
    const description = issue.message ?? null;

    return {
      asin: payload.asin!,
      sku: payload.sku!,
      marketplace_id: marketplaceId,
      country_code: countryCode,
      category,
      type,
      description,
      still_in_amazon: true,
      last_checked_at: null,
      resolved_at: null,
      product_title: null,
      product_image_url: null,
      product_brand: null,
      source_event: event,
    } satisfies PolicyAlertInsert;
  });
}

function mapListingsDefect(event: PolicyIssueEvent): PolicyAlertInsert | null {
  const payload = event.payload?.listingDefect;
  if (!payload?.sku || !payload.asin || !payload.marketplaceId) return null;

  const marketplaceId = payload.marketplaceId;
  const countryCode = resolveCountryFromMarketplace(marketplaceId);

  return {
    asin: payload.asin,
    sku: payload.sku,
    marketplace_id: marketplaceId,
    country_code: countryCode,
    category: payload.affectedCategory ?? "Cumplimiento normativo",
    type: payload.defectType ?? "Defecto de listado",
    description: payload.defectDescription ?? null,
    still_in_amazon: true,
    last_checked_at: null,
    resolved_at: null,
    product_title: null,
    product_image_url: null,
    product_brand: null,
    source_event: event,
  } satisfies PolicyAlertInsert;
}

function mapListingsQuality(event: PolicyIssueEvent): PolicyAlertInsert | null {
  const payload = event.payload?.listingQuality;
  if (!payload?.sku || !payload.asin || !payload.marketplaceId) return null;

  const marketplaceId = payload.marketplaceId;
  const countryCode = resolveCountryFromMarketplace(marketplaceId);

  return {
    asin: payload.asin,
    sku: payload.sku,
    marketplace_id: marketplaceId,
    country_code: countryCode,
    category: payload.affectedCategory ?? "Calidad del listado",
    type: payload.qualityType ?? "Problema de calidad",
    description: payload.qualityDescription ?? null,
    still_in_amazon: true,
    last_checked_at: null,
    resolved_at: null,
    product_title: null,
    product_image_url: null,
    product_brand: null,
    source_event: event,
  } satisfies PolicyAlertInsert;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Maps a raw SP-API notification event to one or more PolicyAlertInsert records.
 * Returns an empty array for unsupported/invalid notification types.
 * Never throws; returns [] on unexpected payloads (§13 guardrail).
 */
export function mapNotificationToAlerts(event: unknown): PolicyAlertInsert[] {
  if (!event || typeof event !== "object") return [];

  let typed: PolicyIssueEvent;
  try {
    typed = event as PolicyIssueEvent;
    if (!typed.notificationType) return [];
  } catch {
    return [];
  }

  try {
    switch (typed.notificationType) {
      case "LISTINGS_ITEM_ISSUES":
        return mapListingsItemIssues(typed) ?? [];
      case "LISTINGS_DEFECT_NOTIFICATIONS": {
        const result = mapListingsDefect(typed);
        return result ? [result] : [];
      }
      case "LISTINGS_QUALITY_NOTIFICATIONS": {
        const result = mapListingsQuality(typed);
        return result ? [result] : [];
      }
      default:
        return [];
    }
  } catch {
    // Do not propagate mapping errors; log and drop (§13: fail safe)
    return [];
  }
}
