import type { FinanceCreditLine, FinancePaymentSource } from "@/modules/finance/types/planning.types";

export function mapBankToPaymentSource(bankName: string): FinancePaymentSource {
  const lower = bankName.toLowerCase();
  if (lower.includes("rural")) return "caja_rural";
  if (lower.includes("caixa")) return "la_caixa";
  if (lower.includes("bbva")) return "bbva";
  return "cash";
}

export function recommendCreditLineForAmount(
  amount: number,
  creditLines: FinanceCreditLine[],
  cashBalance: number,
): { line: FinanceCreditLine | null; source: FinancePaymentSource | null; reason: string } {
  const availableLines = creditLines.filter((line) => {
    const status = line.status.trim().toLowerCase();
    const isActive = status === "activa" || status === "activo" || status === "active";
    return isActive && line.availableAmount >= amount;
  });
  if (availableLines.length > 0) {
    const selected = availableLines[0];
    return {
      line: selected,
      source: mapBankToPaymentSource(selected.bankName),
      reason: `${selected.bankName}: disponibilidad suficiente (${selected.availableAmount.toLocaleString("es-ES")} €). Coste pendiente de configurar.`,
    };
  }

  if (cashBalance >= amount) {
    return {
      line: null,
      source: "cash",
      reason: "Caja propia suficiente; se reserva para pagos no financiables si no hay línea disponible.",
    };
  }

  return {
    line: null,
    source: null,
    reason: "Sin disponibilidad suficiente en líneas ni caja propia.",
  };
}

/**
 * @deprecated Legacy write path. Never creates movements.
 * Official model: finance_create_credit_line_drawdown + repayment groups.
 */
export async function syncCreditLineDueFromSupplierPayment(
  _supplierPaymentId: string,
): Promise<void> {
  // Intentionally a no-op: direct DML on finance_credit_line_movements is forbidden.
}
