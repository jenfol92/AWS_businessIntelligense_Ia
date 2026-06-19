// modules/products/repositories/productSalesRepository.ts

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

type FindProductSalesParams = {
  productId: string;
  windowDays: number;
  pais: string;
  canal: string;
};

// Lee ventas reales desde ventas_diarias.
// Devuelve serie temporal y totales para la ficha.
export async function findProductSalesSummary({
  productId,
  windowDays,
  pais,
  canal,
}: FindProductSalesParams) {
  const supabase = createSupabaseRouteClient();

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - windowDays);

  let query = supabase
    .from("ventas_diarias")
    .select(`
      fecha,
      unidades_vendidas,
      ingresos_brutos,
      publicidad_gasto_ads,
      ingresos_netos_sin_iva,
      beneficio_operativo_neto,
      pais,
      canal_venta
    `)
    .eq("producto_id", productId)
    .gte("fecha", fromDate.toISOString().slice(0, 10))
    .order("fecha", { ascending: true });

  if (pais && pais !== "ALL") {
    query = query.eq("pais", pais);
  }

  if (canal && canal !== "ALL") {
    query = query.eq("canal_venta", canal);
  }

  const { data, error } = await query;

  if (error) throw new Error(error.message);

  return data ?? [];
}