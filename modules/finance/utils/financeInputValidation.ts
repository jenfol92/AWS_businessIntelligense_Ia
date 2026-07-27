/**
 * Shared finance input validators (UUID + real calendar dates + money bounds).
 *
 * Money ceiling is aligned with finance SQL RPCs and unbounded `numeric` columns
 * (see sql/diagnostics/credit_line_maturities_hardening_preflight.sql):
 * create_and_apply_purchase_payment_batch rejects abs(amount) >= 1e10.
 * Amounts are rounded to 4 decimal places before compare/store.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Exclusive absolute bound (same as purchase payment batch RPCs). */
export const FINANCE_MONEY_ABS_EXCLUSIVE_LIMIT = 1e10;

/** Max finite value accepted after round(..., 4). */
export const FINANCE_MONEY_MAX_AFTER_ROUND = 9999999999.9999;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

export function requireUuid(value: unknown, label: string): string {
  if (!isUuid(value)) {
    throw Object.assign(new Error(`${label} debe ser un UUID valido.`), {
      code: "INVALID_UUID",
      status: 422,
    });
  }
  return value.trim();
}

/** Accepts YYYY-MM-DD and rejects non-existent calendar dates (e.g. 2026-02-31). */
export function isRealIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function requireIsoDate(value: unknown, label: string): string {
  if (!isRealIsoDate(value)) {
    throw Object.assign(new Error(`${label} no es una fecha valida.`), {
      code: "INVALID_DATE",
      status: 422,
    });
  }
  return value;
}

export function assertDateRange(from: string | null, to: string | null): void {
  if (from && to && from > to) {
    throw Object.assign(new Error("from no puede ser posterior a to."), {
      code: "INVALID_DATE_RANGE",
      status: 422,
    });
  }
}

export function roundMoney(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function isFinitePositiveMoney(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return false;
  const rounded = roundMoney(value);
  return rounded > 0 && rounded <= FINANCE_MONEY_MAX_AFTER_ROUND;
}
