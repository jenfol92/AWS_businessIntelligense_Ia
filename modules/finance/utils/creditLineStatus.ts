/**
 * Shared credit-line status semantics.
 * cancelled/cancelada = no new drawdowns, debt still repayable.
 * deleted/eliminada = hard block.
 */

export function normalizeCreditLineStatus(status: string | null | undefined): string {
  return String(status ?? "").trim().toLowerCase();
}

export function isActiveCreditLineStatus(status: string | null | undefined): boolean {
  const normalized = normalizeCreditLineStatus(status);
  return normalized === "activa" || normalized === "activo" || normalized === "active";
}

/** Physical deletion only — cancelled lines keep payable debt. */
export function isDeletedCreditLineStatus(status: string | null | undefined): boolean {
  const normalized = normalizeCreditLineStatus(status);
  return normalized === "eliminada" || normalized === "deleted";
}

export function isCancelledOrInactiveCreditLineStatus(
  status: string | null | undefined,
): boolean {
  const normalized = normalizeCreditLineStatus(status);
  return (
    normalized === "inactive"
    || normalized === "inactiva"
    || normalized === "closed"
    || normalized === "cerrada"
    || normalized === "cancelled"
    || normalized === "cancelada"
  );
}

export function creditLineDrawdownAllowed(status: string | null | undefined): boolean {
  return isActiveCreditLineStatus(status);
}

export function creditLineRepaymentAllowed(status: string | null | undefined): boolean {
  return !isDeletedCreditLineStatus(status);
}

export function creditLineNonDrawdownDebtLabel(status: string | null | undefined): string {
  const normalized = normalizeCreditLineStatus(status);
  if (normalized === "cancelled" || normalized === "cancelada") {
    return "Linea cancelada: no admite nuevas disposiciones, pero su deuda sigue siendo pagable.";
  }
  if (isCancelledOrInactiveCreditLineStatus(status) || !isActiveCreditLineStatus(status)) {
    return "Linea inactiva: no admite nuevas disposiciones, pero su deuda sigue siendo pagable.";
  }
  return "";
}
