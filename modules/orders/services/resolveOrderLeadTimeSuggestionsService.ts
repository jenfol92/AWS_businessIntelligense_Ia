import {
  fetchLatestLeadTimeByProduct,
  fetchLatestLeadTimeByProductAndSupplier,
  fetchSupplierLeadTimes,
} from "@/modules/orders/repositories/orderLeadTimeSuggestionRepository";
import type {
  OrderLeadTimeHistoricalRow,
  OrderLeadTimeSuggestion,
  OrderLeadTimeSuggestionRequestItem,
  OrderLeadTimeSupplierRow,
} from "@/modules/orders/types/orderLeadTimeSuggestion.types";

function cleanId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function fromHistorical(
  item: { producto_id: string; proveedor_id: string | null },
  row: OrderLeadTimeHistoricalRow,
  source: "historico_producto_proveedor" | "historico_producto",
): OrderLeadTimeSuggestion {
  return {
    producto_id: item.producto_id,
    proveedor_id: item.proveedor_id,
    lead_time_produccion: row.lead_time_produccion,
    lead_time_transito: row.lead_time_transito,
    source,
    source_order_id: row.orden_id,
    source_fecha_confirmacion: row.fecha_confirmacion,
  };
}

function fromSupplier(
  item: { producto_id: string; proveedor_id: string | null },
  supplier: OrderLeadTimeSupplierRow | null,
): OrderLeadTimeSuggestion | null {
  if (!supplier) return null;
  if (supplier.dias_produccion_estandar == null && supplier.dias_transito_estandar == null) {
    return null;
  }

  return {
    producto_id: item.producto_id,
    proveedor_id: item.proveedor_id,
    lead_time_produccion: supplier.dias_produccion_estandar,
    lead_time_transito: supplier.dias_transito_estandar,
    source: "proveedor",
    source_order_id: null,
    source_fecha_confirmacion: null,
  };
}

function emptySuggestion(item: {
  producto_id: string;
  proveedor_id: string | null;
}): OrderLeadTimeSuggestion {
  return {
    producto_id: item.producto_id,
    proveedor_id: item.proveedor_id,
    lead_time_produccion: null,
    lead_time_transito: null,
    source: "none",
    source_order_id: null,
    source_fecha_confirmacion: null,
  };
}

export async function resolveOrderLeadTimeSuggestionsService(
  rawItems: OrderLeadTimeSuggestionRequestItem[],
): Promise<OrderLeadTimeSuggestion[]> {
  const items = rawItems
    .map((item) => ({
      producto_id: cleanId(item.producto_id),
      proveedor_id: cleanId(item.proveedor_id),
    }))
    .filter((item): item is { producto_id: string; proveedor_id: string | null } =>
      item.producto_id != null,
    );

  const supplierLeadTimes = await fetchSupplierLeadTimes(
    items.map((item) => item.proveedor_id).filter((id): id is string => id != null),
  );

  const suggestions: OrderLeadTimeSuggestion[] = [];

  for (const item of items) {
    if (item.proveedor_id) {
      const productSupplierHistory = await fetchLatestLeadTimeByProductAndSupplier(
        item.producto_id,
        item.proveedor_id,
      );
      if (productSupplierHistory) {
        suggestions.push(
          fromHistorical(item, productSupplierHistory, "historico_producto_proveedor"),
        );
        continue;
      }
    }

    const productHistory = await fetchLatestLeadTimeByProduct(item.producto_id);
    if (productHistory) {
      suggestions.push(fromHistorical(item, productHistory, "historico_producto"));
      continue;
    }

    const supplierSuggestion = fromSupplier(
      item,
      item.proveedor_id ? supplierLeadTimes.get(item.proveedor_id) ?? null : null,
    );
    suggestions.push(supplierSuggestion ?? emptySuggestion(item));
  }

  return suggestions;
}
