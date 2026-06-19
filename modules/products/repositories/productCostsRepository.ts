// modules/products/repositories/productCostsRepository.ts



import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

import {

  type ProductBaseCost,

  resolveEffectiveBaseCost,

} from "../utils/resolveEffectiveBaseCost";



export type { ProductBaseCost } from "../utils/resolveEffectiveBaseCost";



// Tabla: producto_costos.

// Aquí van costes históricos/lotes/fábrica/flete/arancel/transito.

export async function findProductCostsByProductId(productId: string) {

  const supabase = createSupabaseRouteClient();



  const { data, error } = await supabase

    .from("producto_costos")

    .select(`

      id,

      producto_id,

      proveedor_id,

      costo_fabrica_monto,

      costo_fabrica_moneda,

      costo_fabrica_eur,

      tipo_cambio_aplicado,

      arancel_porcentaje,

      transito_eur_unit,

      gastos_llegada_puerto_eur_unit,

      costo_flete_unit_eur,

      costo_unitario_total_eur,

      pais_destino,

      contenedor_id,

      lote_producto,

      fecha

    `)

    .eq("producto_id", productId)

    .order("fecha", { ascending: false });



  if (error) throw new Error(error.message);



  return data ?? [];

}



// Último coste conocido de un producto.

export async function findLatestProductCost(productId: string) {

  const supabase = createSupabaseRouteClient();



  const { data, error } = await supabase

    .from("producto_costos")

    .select("*")

    .eq("producto_id", productId)

    .order("fecha", { ascending: false })

    .limit(1)

    .maybeSingle();



  if (error) throw new Error(error.message);



  return data;

}



// Vista: v_costo_actual_producto.

export async function findCurrentProductCost(productId: string) {

  const supabase = createSupabaseRouteClient();



  const { data, error } = await supabase

    .from("v_costo_actual_producto")

    .select("*")

    .eq("producto_id", productId)

    .maybeSingle();



  if (error) throw new Error(error.message);



  return data;

}



// Vista: v_producto_coste_medio.

export async function findProductAverageCost(productId: string) {

  const supabase = createSupabaseRouteClient();



  const { data, error } = await supabase

    .from("v_producto_coste_medio")

    .select("*")

    .eq("producto_id", productId)

    .maybeSingle();



  if (error) throw new Error(error.message);



  return data;

}



type OwnBaseCostRow = {

  monto: number | null;

  moneda: string | null;

};



async function loadLatestOwnBaseCosts(

  productIds: string[],

): Promise<Map<string, OwnBaseCostRow>> {

  const map = new Map<string, OwnBaseCostRow>();

  if (productIds.length === 0) return map;



  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase

    .from("producto_costos")

    .select("producto_id, costo_fabrica_monto, costo_fabrica_moneda, fecha")

    .in("producto_id", productIds)

    .order("fecha", { ascending: false });



  if (error) throw new Error(error.message);



  for (const row of data ?? []) {

    const pid = row.producto_id as string;

    if (map.has(pid)) continue;

    const monto = row.costo_fabrica_monto;

    map.set(pid, {

      monto: monto != null && Number(monto) > 0 ? Number(monto) : null,

      moneda: row.costo_fabrica_moneda

        ? String(row.costo_fabrica_moneda).toUpperCase()

        : null,

    });

  }



  return map;

}



async function loadParentIdsByProductIds(

  productIds: string[],

): Promise<Map<string, string | null>> {

  const map = new Map<string, string | null>();

  if (productIds.length === 0) return map;



  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase

    .from("productos")

    .select("id, parent_id")

    .in("id", productIds);



  if (error) throw new Error(error.message);



  for (const row of data ?? []) {

    const id = row.id as string;

    const parentId = row.parent_id as string | null;

    map.set(id, parentId ?? null);

  }



  return map;

}



/**

 * Coste base efectivo por producto_id.

 * Regla: propio > 0 → own; si no, padre > 0 → parent; si no → none.

 * No usa heredar_precio ni copia filas a hijos.

 */

export async function getProductBaseCostByProductIds(

  productIds: string[],

): Promise<Map<string, ProductBaseCost>> {

  const result = new Map<string, ProductBaseCost>();

  if (productIds.length === 0) return result;



  const uniqueIds = Array.from(new Set(productIds));

  const ownCosts = await loadLatestOwnBaseCosts(uniqueIds);

  const parentIdsMap = await loadParentIdsByProductIds(uniqueIds);



  const needsParentEffective: string[] = [];



  for (const pid of uniqueIds) {

    const own = ownCosts.get(pid);

    const parentId = parentIdsMap.get(pid) ?? null;



    if (own?.monto != null && own.monto > 0) {

      result.set(pid, {

        monto: own.monto,

        moneda: own.moneda,

        source: "own",

        parentProductId: parentId,

      });

      continue;

    }



    if (parentId) {

      needsParentEffective.push(pid);

    } else {

      result.set(pid, {

        monto: null,

        moneda: null,

        source: "none",

        parentProductId: null,

      });

    }

  }



  if (needsParentEffective.length > 0) {

    const parentIds = Array.from(

      new Set(

        needsParentEffective

          .map((pid) => parentIdsMap.get(pid))

          .filter((id): id is string => Boolean(id)),

      ),

    );



    const parentEffective = await getProductBaseCostByProductIds(parentIds);



    for (const pid of needsParentEffective) {

      const parentId = parentIdsMap.get(pid);

      if (!parentId) {

        result.set(pid, {

          monto: null,

          moneda: null,

          source: "none",

          parentProductId: null,

        });

        continue;

      }



      const parentCost = parentEffective.get(parentId);

      result.set(

        pid,

        resolveEffectiveBaseCost(null, null, parentCost ?? null, parentId),

      );

    }

  }



  for (const pid of uniqueIds) {

    if (!result.has(pid)) {

      result.set(pid, {

        monto: null,

        moneda: null,

        source: "none",

        parentProductId: parentIdsMap.get(pid) ?? null,

      });

    }

  }



  return result;

}



/** Inserta coste manual del día. Borra filas manuales del mismo día antes. */

export async function upsertManualProductCost(

  productId: string,

  payload: Record<string, unknown>,

) {

  const supabase = createSupabaseRouteClient();

  const fechaHoy = new Date().toISOString().slice(0, 10);



  await supabase

    .from("producto_costos")

    .delete()

    .eq("producto_id", productId)

    .is("contenedor_id", null)

    .eq("fecha", fechaHoy);



  const { data, error } = await supabase

    .from("producto_costos")

    .insert({ ...payload, fecha: fechaHoy })

    .select("*")

    .single();



  if (error) throw new Error(error.message);

  return data;

}

