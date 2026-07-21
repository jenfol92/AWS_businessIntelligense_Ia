/**
 * Modulo: finance
 * Archivo: syncSupplierPaymentsForOrder
 * Responsabilidad: sincronizar pagos proveedor persistentes (DEPOSITO_30, BALANCE_70).
 * No debe: generar movimientos de líneas de crédito (FASE 2).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchAmazonInboundForOrder,
  fetchContainerForOrder,
  fetchContainerForSupplierPayments,
  fetchOrderForSupplierPayments,
  upsertSupplierPayment,
  voidPendingSupplierPaymentsForOrder,
  type ContainerForSupplierPayments,
} from "@/modules/finance/repositories/financeSupplierPaymentsRepository";
import type { OrderLogisticsType } from "@/modules/finance/types/supplierPayments.types";
import {
  resolveOrderLogisticsType,
} from "@/modules/finance/utils/resolveOrderLogisticsType";
import {
  resolveBalanceDueDate,
  resolveDepositDueDate,
} from "@/modules/finance/utils/resolveSupplierPaymentDates";
import { buildSupplierPaymentPlanAmounts } from "@/modules/finance/utils/validateSupplierPaymentPlanBase";

export type BackfillSupplierPaymentsResult = {
  found: number;
  synced: number;
  failed: number;
  failedOrderIds: string[];
  errors: Array<{
    orderId: string;
    message: string;
    code?: string | null;
    details?: string | null;
    hint?: string | null;
  }>;
};

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function originalOrderAmount(
  order: NonNullable<Awaited<ReturnType<typeof fetchOrderForSupplierPayments>>>,
  currency: string,
): number {
  const items = order.orden_items ?? [];
  const itemTotal = items.reduce(
    (sum, item) => sum + asNumber(item.coste_unitario_moneda) * asNumber(item.cantidad),
    0,
  );
  if (itemTotal > 0) return itemTotal;
  if (currency === "EUR") return asNumber(order.coste_total_eur);
  if (currency === "USD") return asNumber(order.coste_total_usd);
  return 0;
}

function paymentStatus(dueDate: string | null): "pendiente" | "vencido" {
  if (dueDate && dueDate < new Date().toISOString().slice(0, 10)) return "vencido";
  return "pendiente";
}

function balanceNotes(
  logisticsType: OrderLogisticsType,
  dueDate: string | null,
  balanceDaysBeforeEta: number,
  balancePercent: number,
): string | null {
  if (logisticsType === "amazon_agl") {
    if (dueDate) return `${balancePercent}% calculado en ETD / fecha salida Amazon AGL.`;
    return `Falta ETD/fecha salida Amazon AGL para calcular ${balancePercent}%.`;
  }
  if (logisticsType === "propio") {
    if (dueDate) return `${balancePercent}% calculado ${balanceDaysBeforeEta} dias antes de ETA.`;
    return `Balance ${balancePercent} % sin fecha: falta ETA o días balance antes de ETA.`;
  }
  return `Balance ${balancePercent} % sin fecha: tipo de contenedor no definido.`;
}

/**
 * Crea o actualiza pagos proveedor (DEPOSITO_30, BALANCE_70) para una orden confirmada.
 * No crea duplicados por (orden_id, payment_type).
 */
export async function syncSupplierPaymentsForOrder(
  ordenId: string,
  options?: { container?: ContainerForSupplierPayments | null },
): Promise<void> {
  const order = await fetchOrderForSupplierPayments(ordenId);
  if (!order) return;
  if (order.estado !== "confirmado") {
    await voidPendingSupplierPaymentsForOrder(ordenId);
    return;
  }

  const container = options?.container ?? (await fetchContainerForOrder(ordenId));
  const amazonInbound =
    order.tipo_envio === "amazon_agl" ? await fetchAmazonInboundForOrder(ordenId) : null;
  const logisticsType = resolveOrderLogisticsType({
    orderTipoEnvio: order.tipo_envio,
    containerTipoContenedor: container?.tipo_contenedor,
  });

  const originalCurrency = (order.moneda_compra ?? "USD").trim().toUpperCase() || "USD";
  const baseOriginal = originalOrderAmount(order, originalCurrency);
  const depositPct =
    order.deposito_porcentaje === null || order.deposito_porcentaje === undefined
      ? 30
      : Number(order.deposito_porcentaje);
  const planAmounts = buildSupplierPaymentPlanAmounts({
    orderId: ordenId,
    originalCurrency,
    baseOriginal,
    depositPercent: depositPct,
  });
  const balancePct = 100 - depositPct;

  const depositDate = resolveDepositDueDate(order);
  const balanceDate = resolveBalanceDueDate({ logisticsType, order, container, amazonInbound });
  const balanceDaysBeforeEta = Math.max(0, Number(order.balance_dias_antes_eta ?? 10));

  if (planAmounts.deposit) {
    await upsertSupplierPayment({
      orden_id: ordenId,
      payment_type: "DEPOSITO_30",
      due_date: depositDate,
      amount_original: planAmounts.deposit.amountOriginal,
      original_currency: originalCurrency,
      planned_fx_rate: null,
      amount_eur: planAmounts.deposit.amountEur,
      logistics_type: logisticsType,
      contenedor_id: container?.id ?? null,
      status: paymentStatus(depositDate),
    });
  }

  if (planAmounts.balance) {
    await upsertSupplierPayment({
      orden_id: ordenId,
      payment_type: "BALANCE_70",
      due_date: balanceDate,
      amount_original: planAmounts.balance.amountOriginal,
      original_currency: originalCurrency,
      planned_fx_rate: null,
      amount_eur: planAmounts.balance.amountEur,
      logistics_type: logisticsType,
      contenedor_id: container?.id ?? null,
      status: paymentStatus(balanceDate),
      notes: balanceNotes(logisticsType, balanceDate, balanceDaysBeforeEta, balancePct),
    });
  }
}

/**
 * Actualiza pagos proveedor de las órdenes vinculadas al crear/actualizar contenedor.
 * No crea duplicados: solo upsert por orden_id + payment_type.
 */
export async function refreshSupplierPaymentsFromContainer(
  supabase: SupabaseClient,
  contenedorId: string,
): Promise<void> {
  const container = await fetchContainerForSupplierPayments(contenedorId);
  if (!container) return;

  const { data, error } = await supabase
    .from("contenedor_ordenes")
    .select("orden_id")
    .eq("contenedor_id", contenedorId);

  if (error) throw new Error(error.message);
  const ordenIds = (data ?? []).map((row) => String(row.orden_id));

  for (const ordenId of ordenIds) {
    await syncSupplierPaymentsForOrder(ordenId, { container });
  }
}

/**
 * Rellena pagos faltantes para órdenes ya confirmadas (migración / backfill).
 * Procesa cada orden de forma independiente para no bloquear el calendario si una falla.
 * Registra cada error individual con el orden_id para facilitar el diagnóstico.
 */
export async function backfillMissingSupplierPayments(): Promise<BackfillSupplierPaymentsResult> {
  console.log("[backfill] start");
  try {
    const {
      fetchConfirmedOrderIdsNeedingPaymentRefresh,
      fetchConfirmedOrderIdsWithoutPayments,
    } = await import("@/modules/finance/repositories/financeSupplierPaymentsRepository");

    const missing = await fetchConfirmedOrderIdsWithoutPayments();
    const pendingRefresh = await fetchConfirmedOrderIdsNeedingPaymentRefresh();
    const ordenIds = Array.from(new Set([...missing, ...pendingRefresh]));
    console.log("[backfill] confirmed orders without payments:", missing.length);
    console.log("[backfill] pending refresh:", pendingRefresh.length);
    console.log("[backfill] total to sync:", ordenIds.length);

    if (ordenIds.length === 0) {
      console.log("[backfill] nothing to do, finished");
      return { found: 0, synced: 0, failed: 0, failedOrderIds: [], errors: [] };
    }

    const failed: string[] = [];
    const errors: BackfillSupplierPaymentsResult["errors"] = [];
    for (const ordenId of ordenIds) {
      try {
        await syncSupplierPaymentsForOrder(ordenId);
        console.log("[backfill] order", ordenId, "OK");
      } catch (orderError) {
        const msg = orderError instanceof Error ? orderError.message : String(orderError);
        console.error(`[backfill] orden ${ordenId} error: ${msg}`);
        failed.push(ordenId);
        errors.push({ orderId: ordenId, message: msg });
      }
    }

    if (failed.length > 0) {
      console.error(`[backfill] ${failed.length}/${ordenIds.length} orders failed. IDs: ${failed.join(", ")}`);
    } else {
      console.log(`[backfill] all ${ordenIds.length} orders synced OK`);
    }
    console.log("[backfill] finished");
    return {
      found: ordenIds.length,
      synced: ordenIds.length - failed.length,
      failed: failed.length,
      failedOrderIds: failed,
      errors,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[backfill] general error: ${msg}`);
    console.log("[backfill] finished");
    return {
      found: 0,
      synced: 0,
      failed: 0,
      failedOrderIds: [],
      errors: [{ orderId: "general", message: msg }],
    };
  }
}
