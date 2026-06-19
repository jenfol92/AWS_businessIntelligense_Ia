export type SupplierPaymentType = "DEPOSITO_30" | "BALANCE_70";

export type OrderLogisticsType = "amazon_agl" | "propio" | "sin_definir";

export type SupplierPaymentStatus = "pendiente" | "pagado" | "vencido";

export type SupplierPaymentRow = {
  id: string;
  orden_id: string;
  payment_type: SupplierPaymentType;
  due_date: string | null;
  paid_at: string | null;
  amount_original: number | null;
  original_currency: string;
  planned_fx_rate: number | null;
  amount_eur: number;
  logistics_type: string | null;
  contenedor_id: string | null;
  payment_source: string | null;
  status: SupplierPaymentStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export const SUPPLIER_PAYMENT_TYPE_LABELS: Record<SupplierPaymentType, string> = {
  DEPOSITO_30: "Depósito 30 %",
  BALANCE_70: "Balance 70 %",
};

export const LOGISTICS_TYPE_LABELS: Record<OrderLogisticsType, string> = {
  amazon_agl: "Amazon AGL",
  propio: "Contenedor propio",
  sin_definir: "Sin definir",
};
