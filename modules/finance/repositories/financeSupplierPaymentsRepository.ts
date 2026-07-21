import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SupplierPaymentRow,
  SupplierPaymentType,
} from "@/modules/finance/types/supplierPayments.types";

function formatSupabaseError(error: {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}): string {
  return JSON.stringify({
    message: error.message,
    details: error.details ?? null,
    hint: error.hint ?? null,
    code: error.code ?? null,
  });
}

export type OrderForSupplierPayments = {
  id: string;
  estado: string;
  tipo_envio: string | null;
  numero_orden: string | null;
  numero_pedido_agente: string | null;
  fecha_confirmacion: string | null;
  fecha_orden: string | null;
  eta: string | null;
  eta_real: string | null;
  etd: string | null;
  moneda_compra: string | null;
  coste_total_eur: number | null;
  coste_total_usd: number | null;
  deposito_porcentaje: number | null;
  balance_dias_antes_eta: number | null;
  fecha_pago_balance: string | null;
  agentes_compra:
    | { contacto: string | null }
    | Array<{ contacto: string | null }>
    | null;
  orden_items: Array<{
    cantidad: number | null;
    coste_unitario_moneda: number | null;
  }> | null;
};

export type ContainerForSupplierPayments = {
  id: string;
  identificador_embarque: string | null;
  tipo_contenedor: string | null;
  fecha_salida: string | null;
  fecha_eta_estimada: string | null;
};

export type AmazonInboundForSupplierPayments = {
  shipment_id: string;
  fecha_salida: string | null;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function fetchOrderForSupplierPayments(
  ordenId: string,
): Promise<OrderForSupplierPayments | null> {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("ordenes_compra")
    .select(
      `id, estado, tipo_envio, numero_orden, numero_pedido_agente,
       fecha_confirmacion, fecha_orden, eta, eta_real, etd,
       moneda_compra, coste_total_eur, coste_total_usd,
       deposito_porcentaje, balance_dias_antes_eta, fecha_pago_balance,
       agentes_compra(contacto),
       orden_items(cantidad, coste_unitario_moneda)`,
    )
    .eq("id", ordenId)
    .maybeSingle();

  if (error) throw new Error(formatSupabaseError(error));
  return (data as OrderForSupplierPayments | null) ?? null;
}

export async function fetchAmazonInboundForOrder(
  ordenId: string,
): Promise<AmazonInboundForSupplierPayments | null> {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("orden_logistics_assignments")
    .select(
      `shipment_id,
       amazon_inbound_shipments(shipment_id, fecha_salida)`,
    )
    .eq("orden_id", ordenId)
    .eq("status", "active")
    .eq("assignment_type", "amazon_inbound")
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(formatSupabaseError(error));
  const rawShipment = (data as {
    shipment_id?: string | null;
    amazon_inbound_shipments?:
      | AmazonInboundForSupplierPayments
      | AmazonInboundForSupplierPayments[]
      | null;
  } | null)?.amazon_inbound_shipments;
  const shipment = firstRelation(rawShipment);
  if (shipment) return shipment;
  const shipmentId = (data as { shipment_id?: string | null } | null)?.shipment_id;
  return shipmentId ? { shipment_id: shipmentId, fecha_salida: null } : null;
}

export async function fetchContainerForSupplierPayments(
  contenedorId: string,
): Promise<ContainerForSupplierPayments | null> {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("contenedores")
    .select("id, identificador_embarque, tipo_contenedor, fecha_salida, fecha_eta_estimada")
    .eq("id", contenedorId)
    .maybeSingle();

  if (error) throw new Error(formatSupabaseError(error));
  return (data as ContainerForSupplierPayments | null) ?? null;
}

export async function fetchContainerForOrder(
  ordenId: string,
): Promise<ContainerForSupplierPayments | null> {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("contenedor_ordenes")
    .select(
      `contenedores(id, identificador_embarque, tipo_contenedor, fecha_salida, fecha_eta_estimada)`,
    )
    .eq("orden_id", ordenId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(formatSupabaseError(error));
  const container = firstRelation(
    (data as { contenedores?: ContainerForSupplierPayments | ContainerForSupplierPayments[] | null })
      ?.contenedores,
  );
  return container ?? null;
}

export async function fetchSupplierPaymentByType(
  ordenId: string,
  paymentType: SupplierPaymentType,
): Promise<SupplierPaymentRow | null> {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("finance_supplier_payments")
    .select("*")
    .eq("orden_id", ordenId)
    .eq("payment_type", paymentType)
    .maybeSingle();

  if (error) throw new Error(formatSupabaseError(error));
  return (data as SupplierPaymentRow | null) ?? null;
}

/**
 * Lee en lote los pagos proveedor existentes para las órdenes indicadas.
 * Es una consulta de solo lectura para vistas de resumen: no crea, recalcula ni sincroniza pagos.
 *
 * @param supabase - Cliente Supabase autenticado de la ruta.
 * @param orderIds - IDs de órdenes vinculadas a contenedores.
 * @returns Filas persistidas en finance_supplier_payments para esas órdenes.
 */
export async function fetchSupplierPaymentsByOrderIds(
  supabase: SupabaseClient,
  orderIds: string[],
): Promise<SupplierPaymentRow[]> {
  const uniqueOrderIds = Array.from(new Set(orderIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueOrderIds.length === 0) return [];

  const { data, error } = await supabase
    .from("finance_supplier_payments")
    .select(
      `id, orden_id, contenedor_id, payment_type,
       amount_original, original_currency, planned_fx_rate, amount_eur,
       actual_amount_original, actual_amount_eur, actual_fx_rate, bank_fee_eur, ff_fee_eur,
       bank_reference,
       due_date, paid_at, status`,
    )
    .in("orden_id", uniqueOrderIds);

  if (error) throw new Error(formatSupabaseError(error));
  return (data ?? []) as SupplierPaymentRow[];
}

export type UpsertSupplierPaymentInput = {
  orden_id: string;
  payment_type: SupplierPaymentType;
  due_date: string | null;
  amount_original: number;
  original_currency: string;
  planned_fx_rate: number | null;
  amount_eur: number;
  logistics_type: string | null;
  contenedor_id: string | null;
  status: "pendiente" | "pagado" | "vencido";
  notes?: string | null;
};

export async function upsertSupplierPayment(
  input: UpsertSupplierPaymentInput,
): Promise<SupplierPaymentRow> {
  const supabase = createSupabaseRouteClient();
  const existing = await fetchSupplierPaymentByType(input.orden_id, input.payment_type);

  if (existing?.status === "pagado") {
    return existing;
  }

  const payload = {
    orden_id: input.orden_id,
    payment_type: input.payment_type,
    due_date: input.due_date,
    amount_original: input.amount_original,
    original_currency: input.original_currency,
    planned_fx_rate: input.planned_fx_rate,
    amount_eur: input.amount_eur,
    logistics_type: input.logistics_type,
    contenedor_id: input.contenedor_id,
    status: input.status,
    notes: input.notes ?? null,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { data, error } = await supabase
      .from("finance_supplier_payments")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(formatSupabaseError(error));
    return data as SupplierPaymentRow;
  }

  const { data, error } = await supabase
    .from("finance_supplier_payments")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  return data as SupplierPaymentRow;
}

export async function voidPendingSupplierPaymentsForOrder(
  ordenId: string,
): Promise<void> {
  const supabase = createSupabaseRouteClient();
  const { error } = await supabase
    .from("finance_supplier_payments")
    .delete()
    .eq("orden_id", ordenId)
    .in("status", ["pendiente", "vencido"]);

  if (error) throw new Error(formatSupabaseError(error));
}

export async function fetchSupplierPaymentsInRange(
  fromDate: string,
  toDate: string,
): Promise<Record<string, unknown>[]> {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("finance_supplier_payments")
    .select(
      `*,
       ordenes_compra(
         id, numero_orden, numero_pedido_agente, estado,
         moneda_compra, deposito_porcentaje,
         orden_items(cantidad, coste_unitario_moneda),
         agentes_compra(contacto)
       ),
       contenedores(id, identificador_embarque, tipo_contenedor)`,
    )
    .or(`due_date.gte.${fromDate},due_date.lte.${toDate},due_date.is.null`)
    .order("due_date", { ascending: true, nullsFirst: false });

  if (error) throw new Error(formatSupabaseError(error));
  return (data ?? []) as Record<string, unknown>[];
}

export async function fetchConfirmedOrderIdsNeedingPaymentRefresh(): Promise<string[]> {
  const supabase = createSupabaseRouteClient();
  // Captura registros con logistics_type nulo, en formato canónico (sin_definir)
  // o en formato legado (SIN_DEFINIR) para que el backfill los corrija.
  const { data, error } = await supabase
    .from("finance_supplier_payments")
    .select("orden_id")
    .eq("status", "pendiente")
    .or("logistics_type.is.null,logistics_type.eq.sin_definir,logistics_type.eq.SIN_DEFINIR");

  if (error) throw new Error(formatSupabaseError(error));
  return Array.from(new Set((data ?? []).map((row) => String(row.orden_id))));
}

export async function fetchConfirmedOrderIdsWithoutPayments(): Promise<string[]> {
  const supabase = createSupabaseRouteClient();
  const { data: orders, error: ordersError } = await supabase
    .from("ordenes_compra")
    .select("id")
    .eq("estado", "confirmado");

  if (ordersError) throw new Error(formatSupabaseError(ordersError));
  const orderIds = (orders ?? []).map((row) => String(row.id));
  if (orderIds.length === 0) return [];

  const { data: payments, error: paymentsError } = await supabase
    .from("finance_supplier_payments")
    .select("orden_id")
    .in("orden_id", orderIds);

  if (paymentsError) throw new Error(formatSupabaseError(paymentsError));
  const withPayments = new Set((payments ?? []).map((row) => String(row.orden_id)));
  return orderIds.filter((id) => !withPayments.has(id));
}
