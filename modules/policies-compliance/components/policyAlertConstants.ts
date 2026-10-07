/**
 * modules/policies-compliance/components/policyAlertConstants.ts
 *
 * Static display constants for the UI.
 * No calculations. No logic. Only labels and colour tokens.
 */

import type { PolicyAlertStatus } from "../types/policyCompliance.types";

// ─── Table column headers ─────────────────────────────────────────────────────

export const POLICY_ALERT_COLUMNS = [
  { key: "created_at",        label: "Fecha" },
  { key: "product",           label: "Producto" },
  { key: "sku",               label: "SKU" },
  { key: "asin",              label: "ASIN" },
  { key: "category",          label: "Concepto" },
  { key: "type",              label: "Motivo" },
  { key: "countries",         label: "Países afectados" },
  { key: "marketplace_statuses", label: "Estado por país" },
  { key: "actions",           label: "" },
] as const;

// ─── Status badge styles ───────────────────────────────────────────────────────

export const STATUS_BADGE: Record<
  PolicyAlertStatus,
  { label: string; className: string }
> = {
  active: {
    label: "Activa",
    className: "bg-red-100 text-red-800",
  },
  resolved: {
    label: "Resuelta",
    className: "bg-emerald-100 text-emerald-800",
  },
  pending_review: {
    label: "Pendiente de revisión",
    className: "bg-amber-100 text-amber-800",
  },
};
