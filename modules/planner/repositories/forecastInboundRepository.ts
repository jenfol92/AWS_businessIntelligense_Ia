import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { resolveInboundScope } from "../services/resolveInboundScope";
import {
  buildForecastInboundScheduleEntry,
  resolveInboundPlanningKind,
  usableForPlanning,
} from "../services/resolveInboundPlanningKind";
import type {
  ForecastInboundItem,
  ForecastInboundItemRaw,
  ForecastInboundProductSummary,
  ForecastInboundScheduleEntry,
} from "../types/forecastInbound.types";

type ContainerQtyMismatch = {
  contenedor_id: string;
  producto_id: string;
  unidades_contenedor: number;
  unidades_ordenes: number;
};

function enrichInboundItem(row: ForecastInboundItemRaw): ForecastInboundItem {
  const scope = resolveInboundScope({
    destinoOrden: row.destino_orden,
    tipoContenedor: row.tipo_contenedor,
    puertoLlegada: row.puerto_llegada,
    transitario: row.transitario,
  });

  const warnings: string[] = [];
  if (scope.warning) warnings.push(scope.warning);
  if (!row.has_contenedor && row.confidence === "provisional") {
    warnings.push(
      "Orden confirmada sin contenedor vinculado; se usa ETA de la orden para planificación.",
    );
  } else if (!row.has_contenedor) {
    warnings.push(
      "Orden en curso sin contenedor vinculado; la ETA de la orden no es fiable.",
    );
  }
  if (row.unidades_pendientes <= 0) {
    warnings.push("Sin unidades pendientes de inbound.");
  }

  return {
    ...row,
    forecast_country: scope.country,
    forecast_channel: scope.channel,
    warnings,
  };
}

async function fetchContainerQuantityMismatches(
  contenedorIds: string[],
): Promise<Map<string, ContainerQtyMismatch>> {
  const map = new Map<string, ContainerQtyMismatch>();
  if (contenedorIds.length === 0) return map;

  const supabase = createSupabaseRouteClient();
  const { error } = await supabase.from("contenedor_items").select("contenedor_id").limit(1);
  if (error) return map;

  for (let i = 0; i < contenedorIds.length; i += 100) {
    const chunk = contenedorIds.slice(i, i + 100);
    const { data, error: qErr } = await supabase
      .from("contenedor_items")
      .select("contenedor_id, producto_id, unidades_total")
      .in("contenedor_id", chunk);

    if (qErr) continue;

    for (const ci of data ?? []) {
      const row = ci as {
        contenedor_id: string;
        producto_id: string;
        unidades_total: number;
      };

      const { data: orderQtyRows } = await supabase
        .from("contenedor_ordenes")
        .select("orden_id")
        .eq("contenedor_id", row.contenedor_id);

      const ordenIds = (orderQtyRows ?? []).map(
        (r) => (r as { orden_id: string }).orden_id,
      );
      if (ordenIds.length === 0) continue;

      const { data: items } = await supabase
        .from("orden_items")
        .select("cantidad")
        .in("orden_id", ordenIds)
        .eq("producto_id", row.producto_id);

      const unidadesOrdenes = (items ?? []).reduce(
        (sum, item) => sum + Number((item as { cantidad?: number }).cantidad ?? 0),
        0,
      );

      if (unidadesOrdenes !== Number(row.unidades_total ?? 0)) {
        map.set(`${row.contenedor_id}|${row.producto_id}`, {
          contenedor_id: row.contenedor_id,
          producto_id: row.producto_id,
          unidades_contenedor: Number(row.unidades_total ?? 0),
          unidades_ordenes: unidadesOrdenes,
        });
      }
    }
  }

  return map;
}

export async function fetchForecastInboundItems(params?: {
  productoIds?: string[];
}): Promise<ForecastInboundItem[]> {
  const supabase = createSupabaseRouteClient();

  let query = supabase.from("v_forecast_inbound_items").select("*");
  if (params?.productoIds?.length) {
    query = query.in("producto_id", params.productoIds);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rawRows = (data ?? []) as ForecastInboundItemRaw[];
  const enriched = rawRows
    .filter((row) => row.unidades_pendientes > 0)
    .map(enrichInboundItem);

  const contenedorIds = Array.from(
    new Set(
      enriched
        .map((r) => r.contenedor_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const mismatches = await fetchContainerQuantityMismatches(contenedorIds);
  const mismatchWarning =
    "Las unidades del contenedor no coinciden con las unidades de las órdenes vinculadas.";

  return enriched.map((row) => {
    if (!row.contenedor_id) return row;
    const key = `${row.contenedor_id}|${row.producto_id}`;
    if (!mismatches.has(key)) return row;
    return {
      ...row,
      warnings: row.warnings.includes(mismatchWarning)
        ? row.warnings
        : [...row.warnings, mismatchWarning],
    };
  });
}

function buildScheduleForProduct(
  items: ForecastInboundItem[],
): ForecastInboundScheduleEntry[] {
  const schedule: ForecastInboundScheduleEntry[] = [];

  for (const item of items) {
    const entry = buildForecastInboundScheduleEntry(item);
    if (entry) schedule.push(entry);
  }

  return schedule;
}

export async function fetchForecastInboundByProductIds(
  productIds: string[],
): Promise<Map<string, ForecastInboundProductSummary>> {
  const result = new Map<string, ForecastInboundProductSummary>();
  if (productIds.length === 0) return result;

  const allItems = await fetchForecastInboundItems({ productoIds: productIds });

  for (const productId of productIds) {
    const items = allItems.filter((row) => row.producto_id === productId);
    let stockInboundConfirmed = 0;
    let stockInboundProvisional = 0;
    let capitalAlreadyCommitted = 0;

    for (const item of items) {
      const kind = resolveInboundPlanningKind(item);
      if (usableForPlanning(kind)) {
        stockInboundConfirmed += item.unidades_pendientes;
      } else {
        stockInboundProvisional += item.unidades_pendientes;
      }
      capitalAlreadyCommitted +=
        item.unidades_pendientes * Number(item.coste_unitario_eur ?? 0);
    }

    result.set(productId, {
      productoId: productId,
      stockInboundConfirmed,
      stockInboundProvisional,
      capitalAlreadyCommitted,
      schedule: buildScheduleForProduct(items),
      items,
    });
  }

  return result;
}

export function sumCapitalAlreadyCommitted(
  summaries: Iterable<ForecastInboundProductSummary>,
): number {
  return Array.from(summaries).reduce(
    (total, summary) => total + summary.capitalAlreadyCommitted,
    0,
  );
}
