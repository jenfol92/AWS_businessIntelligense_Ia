export type SupplierPaymentType = "DEPOSITO_30" | "BALANCE_70";

export type OrderLogisticsType = "amazon_agl" | "propio" | "sin_definir";

export type SupplierPaymentStatus = "pendiente" | "parcial" | "pagado" | "vencido";

export type SupplierPaymentRow = {
  id: string;
  orden_id: string;
  payment_type: SupplierPaymentType;
  due_date: string | null;
  paid_at: string | null;
  amount_original: number | null;
  original_currency: string;
  planned_fx_rate: number | null;
  planned_fx_foreign_per_eur: number | null;
  actual_fx_rate: number | null;
  actual_fx_foreign_per_eur: number | null;
  amount_eur: number;
  actual_amount_original: number | null;
  actual_amount_eur: number | null;
  bank_fee_eur: number | null;
  ff_fee_eur: number | null;
  bank_reference: string | null;
  logistics_type: string | null;
  contenedor_id: string | null;
  payment_source: string | null;
  payment_source_type?: string | null;
  cash_account_id?: string | null;
  credit_line_id?: string | null;
  status: SupplierPaymentStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export const SUPPLIER_PAYMENT_TYPE_LABELS: Record<SupplierPaymentType, string> = {
  DEPOSITO_30: "Depósito 30 %",
  BALANCE_70: "Balance 70 %",
};

export function getSupplierPaymentPercentLabel(
  paymentType: SupplierPaymentType,
  depositPercent: number | null | undefined,
): string {
  const deposit = Number.isFinite(Number(depositPercent)) ? Number(depositPercent) : 30;
  const balance = 100 - deposit;
  if (paymentType === "DEPOSITO_30") return `Depósito ${deposit} %`;
  return `Balance ${balance} %`;
}

export const LOGISTICS_TYPE_LABELS: Record<OrderLogisticsType, string> = {
  amazon_agl: "Amazon AGL",
  propio: "Contenedor propio",
  sin_definir: "Sin definir",
};
