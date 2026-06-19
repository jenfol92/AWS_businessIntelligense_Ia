// modules/products/repositories/productProfitabilityRepository.ts

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

type Params = {
  productId: string;
  pais: string;
  canal: string;
};

// Rentabilidad actual general del producto.
export async function findCurrentProfitability(productId: string) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("v_profitabilidad_actual")
    .select("*")
    .eq("producto_id", productId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data;
}

// Rentabilidad por país/canal, si quieres usar datos más específicos.
export async function findProfitabilityByCountryAndChannel({
  productId,
  pais,
  canal,
}: Params) {
  const supabase = createSupabaseRouteClient();

  let query = supabase
    .from("v_profitabilidad_por_pais")
    .select("*")
    .eq("producto_id", productId);

  if (pais && pais !== "ALL") {
    query = query.eq("pais_code", pais);
  }

  if (canal && canal !== "ALL") {
    query = query.eq("channel", canal);
  }

  const { data, error } = await query.limit(1).maybeSingle();

  if (error) throw new Error(error.message);

  return data;
}