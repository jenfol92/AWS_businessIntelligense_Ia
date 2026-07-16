/**
 * Módulo      : orders
 * Archivo     : services/prepareOrderItemsForPersistence.ts
 * Responsabilidad: prepara las líneas de una orden antes de insertarlas en Supabase.
 *                  Congela CBM desde producto_logistica y costes desde producto_costos,
 *                  genera warnings, elimina columnas generadas y construye el payload final.
 * No debe     : ejecutar el INSERT — ese paso lo hace el repository.
 *               Cambiar reglas de negocio de CBM ni de costes.
 */

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { getCubicajeUnitarioByProductIds } from "@/modules/products/repositories/productLogisticsRepository";
import type { LatestFactoryCost } from "@/modules/orders/repositories/orderProductCostsRepository";
import { resolveFactoryCostsForProducts } from "@/modules/orders/services/resolveFactoryCostsForProducts";
import { mapFactoryCostToOrderItem } from "@/modules/orders/utils/mapFactoryCostToOrderItem";
import { isPositiveCostMonto } from "@/modules/products/utils/resolveEffectiveBaseCost";
import type {
  InsertOrderItemInput,
  OrderItemCostWarning,
} from "@/modules/orders/types/orderPersistence.types";

// ─────────────────────────────────────────────────────────────────────────────
// Tipo interno
// ─────────────────────────────────────────────────────────────────────────────

type ResolvedOrderItemsCost = {
  items: Omit<InsertOrderItemInput, "orden_id">[];
  warnings: OrderItemCostWarning[];
};

// ─────────────────────────────────────────────────────────────────────────────
// CBM snapshot desde producto_logistica
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Congela cbm_unitario desde producto_logistica al insertar líneas de orden.
 * Si el producto no tiene fila de logística, conserva el valor del payload.
 *
 * Exportada para uso directo en updateOrderDraft (repository).
 */
export async function resolveOrderItemsCbmUnitario(
  items: Omit<InsertOrderItemInput, "orden_id">[],
): Promise<Omit<InsertOrderItemInput, "orden_id">[]> {
  if (items.length === 0) return items;

  const productIds = Array.from(
    new Set(items.map((item) => item.producto_id).filter(Boolean)),
  );
  const cbmMap = await getCubicajeUnitarioByProductIds(productIds);

  return items.map((item) => {
    if (!cbmMap.has(item.producto_id)) {
      return { ...item, cbm_unitario: item.cbm_unitario ?? 0 };
    }
    const fromLogistics = cbmMap.get(item.producto_id);
    return {
      ...item,
      cbm_unitario: fromLogistics ?? item.cbm_unitario ?? 0,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Coste snapshot desde producto_costos + tipo cambio de la orden
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Costes de fábrica: último producto_costos por producto; fallback a coste base del padre.
 */
async function loadFactoryCostsForOrderItems(
  productIds: string[],
): Promise<Map<string, LatestFactoryCost>> {
  return resolveFactoryCostsForProducts(productIds);
}

/**
 * Congela coste_unitario_* desde producto_costos (o coste manual del usuario).
 *
 * Exportada para uso directo en updateOrderDraft (repository).
 */
export async function resolveOrderItemsCosteUnitario(
  orderId: string,
  items: Omit<InsertOrderItemInput, "orden_id">[],
): Promise<ResolvedOrderItemsCost> {
  if (items.length === 0) return { items: [], warnings: [] };

  const supabase = createSupabaseRouteClient();
  const { data: order, error: orderError } = await supabase
    .from("ordenes_compra")
    .select("moneda_compra, tipo_cambio_moneda_eur, tipo_cambio_usd_eur")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError) throw new Error(orderError.message);

  const monedaOrden = (order?.moneda_compra ?? "USD").toString().toUpperCase();
  const tipoCambioOrden =
    order?.tipo_cambio_moneda_eur ?? order?.tipo_cambio_usd_eur ?? null;

  const productIds = Array.from(
    new Set(items.map((item) => item.producto_id).filter(Boolean)),
  );
  const factoryCostMap = await loadFactoryCostsForOrderItems(productIds);
  const warnings: OrderItemCostWarning[] = [];

  const resolvedItems = items.map((item) => {
    const mapped = mapFactoryCostToOrderItem({
      factoryCost: factoryCostMap.get(item.producto_id),
      orderMoneda: monedaOrden,
      orderTipoCambio: tipoCambioOrden != null ? Number(tipoCambioOrden) : null,
      userCosteMoneda: isPositiveCostMonto(item.coste_unitario_moneda)
        ? item.coste_unitario_moneda
        : isPositiveCostMonto(item.coste_unitario_usd) && monedaOrden === "USD"
          ? item.coste_unitario_usd
          : null,
      userCosteEur: item.coste_unitario_eur,
      userCosteUsd: item.coste_unitario_usd,
    });

    if (mapped.missingHistoricalCost) {
      warnings.push({
        producto_id: item.producto_id,
        code: "missing_historical_cost",
      });
      return {
        ...item,
        coste_unitario_moneda: null,
        coste_unitario_eur: null,
        coste_unitario_usd: null,
      };
    }

    return {
      ...item,
      coste_unitario_moneda: mapped.coste_unitario_moneda,
      coste_unitario_eur: mapped.coste_unitario_eur,
      coste_unitario_usd: mapped.coste_unitario_usd,
    };
  });

  return { items: resolvedItems, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Orquestador público
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prepara las líneas de una orden para ser insertadas:
 *   1. Congela cbm_unitario desde producto_logistica.
 *   2. Congela costes desde producto_costos con el tipo de cambio de la orden.
 *   3. Adjunta orden_id y elimina cbm_total (columna generada, Postgres rechaza el INSERT).
 *
 * @param orderId - UUID de la orden a la que pertenecen las líneas.
 * @param items   - Líneas sin orden_id.
 * @returns Filas listas para INSERT y warnings de costes pendientes.
 */
export async function prepareOrderItemsForPersistence(
  orderId: string,
  items: Omit<InsertOrderItemInput, "orden_id">[],
): Promise<{ rows: Record<string, unknown>[]; warnings: OrderItemCostWarning[] }> {
  let resolvedItems = await resolveOrderItemsCbmUnitario(items);
  const costResolved = await resolveOrderItemsCosteUnitario(orderId, resolvedItems);
  resolvedItems = costResolved.items;

  // Adjuntar orden_id y eliminar cbm_total — columna GENERATED ALWAYS, Postgres rechaza INSERT.
  const rows = resolvedItems.map((item) => {
    const { ...rest } = item as Record<string, unknown>;
    delete rest["cbm_total"];
    delete rest["item_id"];
    return { ...rest, orden_id: orderId };
  });

  return { rows, warnings: costResolved.warnings };
}
