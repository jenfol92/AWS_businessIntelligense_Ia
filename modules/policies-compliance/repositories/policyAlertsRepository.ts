/**
 * modules/policies-compliance/repositories/policyAlertsRepository.ts
 *
 * Database access layer for product_policy_alerts.
 * Uses supabaseAdmin (service role) for all writes; route clients for user-scoped reads.
 *
 * Guardrails:
 *   - All writes are idempotent via upsert on (asin, sku, marketplace_id, category, type).
 *   - Never coerce NULL fields to empty strings or zero.
 *   - Writes do not affect finance state.
 */

import { supabaseAdmin } from "@/server/supabase/adminClient";
import type {
  PolicyAlert,
  PolicyAlertInsert,
  PolicyAlertUpdate,
} from "../types/policyCompliance.types";

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function listAllPolicyAlerts(): Promise<PolicyAlert[]> {
  const { data, error } = await supabaseAdmin
    .from("product_policy_alerts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listAllPolicyAlerts: ${error.message}`);
  return (data ?? []) as PolicyAlert[];
}

export async function listPolicyAlertsByAsin(asin: string): Promise<PolicyAlert[]> {
  const { data, error } = await supabaseAdmin
    .from("product_policy_alerts")
    .select("*")
    .eq("asin", asin)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listPolicyAlertsByAsin(${asin}): ${error.message}`);
  return (data ?? []) as PolicyAlert[];
}

export async function findPolicyAlertById(id: string): Promise<PolicyAlert | null> {
  const { data, error } = await supabaseAdmin
    .from("product_policy_alerts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`findPolicyAlertById(${id}): ${error.message}`);
  return (data ?? null) as PolicyAlert | null;
}

/** Returns all alerts that are still active according to Amazon (for cron sync). */
export async function listActivePolicyAlerts(): Promise<PolicyAlert[]> {
  const { data, error } = await supabaseAdmin
    .from("product_policy_alerts")
    .select("*")
    .eq("still_in_amazon", true)
    .order("last_checked_at", { ascending: true, nullsFirst: true });

  if (error) throw new Error(`listActivePolicyAlerts: ${error.message}`);
  return (data ?? []) as PolicyAlert[];
}

// ─── Write (idempotent) ───────────────────────────────────────────────────────

/**
 * Upserts an alert. Identity key: (asin, sku, marketplace_id, category, type).
 * On conflict, updates description, source_event, and product enrichment if provided.
 * Does NOT reset still_in_amazon to TRUE on repeat events (that would hide resolved state).
 */
export async function upsertPolicyAlert(alert: PolicyAlertInsert): Promise<PolicyAlert> {
  const { data, error } = await supabaseAdmin
    .from("product_policy_alerts")
    .upsert(
      {
        ...alert,
        still_in_amazon: true, // new or re-surfaced event means Amazon still shows it
      },
      {
        onConflict: "asin,sku,marketplace_id,category,type",
        // Do not override still_in_amazon if Amazon had already cleared it and
        // it reappears — we do want to re-activate in that case, so still_in_amazon: true
        // is intentionally set above.
        ignoreDuplicates: false,
      },
    )
    .select()
    .single();

  if (error) throw new Error(`upsertPolicyAlert: ${error.message}`);
  return data as PolicyAlert;
}

/**
 * Applies a partial update to a single alert (e.g. resolved_at, still_in_amazon).
 */
export async function updatePolicyAlert(
  id: string,
  patch: PolicyAlertUpdate,
): Promise<PolicyAlert> {
  const { data, error } = await supabaseAdmin
    .from("product_policy_alerts")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(`updatePolicyAlert(${id}): ${error.message}`);
  return data as PolicyAlert;
}

/**
 * Phase 0: an internal action is not Amazon evidence. Keep the entry point but
 * block it until internal workflow and Amazon observation can be separated.
 */
export async function markAlertResolvedInternally(_id: string): Promise<PolicyAlert> {
  throw new Error("POLICY_RESOLUTION_REQUIRES_AMAZON_EVIDENCE");
}

/**
 * Updates metadata only after a successful positive observation in Phase 0.
 */
export async function updateAlertSyncState(
  id: string,
  params: { stillInAmazon: boolean; checkedAt: string },
): Promise<PolicyAlert> {
  if (!params.stillInAmazon) throw new Error("POLICY_AUTOMATIC_RESOLUTION_DISABLED_PHASE_0");
  const patch: PolicyAlertUpdate = {
    still_in_amazon: params.stillInAmazon,
    last_checked_at: params.checkedAt,
  };
  return updatePolicyAlert(id, patch);
}
