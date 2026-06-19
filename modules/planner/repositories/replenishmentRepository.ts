import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export type LastOrderLeadTimeRow = {
  productoId: string;
  leadTimeProduccion: number | null;
  leadTimeTransito: number | null;
};

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Última orden confirmada por producto (lead time real al confirmar). */
export async function fetchLastOrderLeadTimesByProductIds(
  productIds: string[],
): Promise<Map<string, LastOrderLeadTimeRow>> {
  const result = new Map<string, LastOrderLeadTimeRow>();
  if (productIds.length === 0) return result;

  const supabase = createSupabaseRouteClient();

  for (const chunk of chunkArray(productIds, 100)) {
    const { data, error } = await supabase
      .from("orden_items")
      .select(
        "producto_id, ordenes_compra!inner(lead_time_produccion, lead_time_transito, estado, fecha_confirmacion, created_at)",
      )
      .in("producto_id", chunk)
      .eq("ordenes_compra.estado", "confirmado")
      .order("fecha_confirmacion", {
        ascending: false,
        foreignTable: "ordenes_compra",
      });

    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      const r = row as {
        producto_id: string;
        ordenes_compra:
          | {
              lead_time_produccion: number | null;
              lead_time_transito: number | null;
            }
          | {
              lead_time_produccion: number | null;
              lead_time_transito: number | null;
            }[];
      };

      if (result.has(r.producto_id)) continue;

      const order = Array.isArray(r.ordenes_compra)
        ? r.ordenes_compra[0]
        : r.ordenes_compra;

      result.set(r.producto_id, {
        productoId: r.producto_id,
        leadTimeProduccion:
          order?.lead_time_produccion != null
            ? Number(order.lead_time_produccion)
            : null,
        leadTimeTransito:
          order?.lead_time_transito != null
            ? Number(order.lead_time_transito)
            : null,
      });
    }
  }

  return result;
}

/** Ventas agregadas en ventana reciente por producto. */
export async function fetchRecentSalesByProductIds(
  productIds: string[],
  windowDays: number,
  country?: string,
  ventasCanal?: string | null,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (productIds.length === 0 || windowDays <= 0) return result;

  const supabase = createSupabaseRouteClient();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - windowDays);
  const fromStr = fromDate.toISOString().slice(0, 10);

  for (const chunk of chunkArray(productIds, 120)) {
    let offset = 0;
    const pageSize = 1000;

    for (;;) {
      let q = supabase
        .from("ventas_diarias")
        .select("producto_id, unidades_vendidas")
        .gte("fecha", fromStr)
        .in("producto_id", chunk)
        .order("fecha", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (country && country !== "ALL") q = q.eq("pais", country);
      if (ventasCanal) q = q.eq("canal_venta", ventasCanal);

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      for (const row of data ?? []) {
        const r = row as { producto_id: string; unidades_vendidas: number | null };
        result.set(
          r.producto_id,
          (result.get(r.producto_id) ?? 0) + Number(r.unidades_vendidas ?? 0),
        );
      }

      if ((data ?? []).length < pageSize) break;
      offset += pageSize;
    }
  }

  return result;
}
