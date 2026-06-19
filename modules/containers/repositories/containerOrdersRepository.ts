import type { SupabaseClient } from "@supabase/supabase-js";



import {

  ORDER_ALREADY_HAS_CONTAINER,

  type ContainerOrderLinkValidationResult,

} from "@/modules/containers/types/containerOrderLink.types";

import { fetchOrderContainerAssignments } from "@/modules/orders/repositories/orderContainerRepository";



type OrderLinkRow = {

  contenedor_id: string;

  orden_id: string;

  ordenes_compra: Record<string, unknown> | Record<string, unknown>[] | null;

};



export async function fetchContainerOrderLinks(

  supabase: SupabaseClient,

  containerIds: string[],

): Promise<OrderLinkRow[]> {

  if (containerIds.length === 0) return [];



  const { data, error } = await supabase

    .from("contenedor_ordenes")

    .select(

      "contenedor_id, orden_id, ordenes_compra(id, numero_orden, agente_id, coste_total_eur, cbm_total, fob_puerto, destino, eta, agentes_compra(contacto))",

    )

    .in("contenedor_id", containerIds);



  if (error) throw new Error(error.message);

  return (data ?? []) as OrderLinkRow[];

}



type ValidateOrdersOptions = {

  /** Al vincular a un contenedor existente, permite órdenes ya vinculadas a ese mismo contenedor. */

  targetContenedorId?: string;

};



export async function validateOrdersForContainerLink(

  supabase: SupabaseClient,

  ordenIds: string[],

  options: ValidateOrdersOptions = {},

): Promise<ContainerOrderLinkValidationResult> {

  if (ordenIds.length === 0) {

    return { ok: true, ordenIdsToLink: [] };

  }



  const uniqueOrdenIds = Array.from(new Set(ordenIds.map((id) => id.trim()).filter(Boolean)));



  const { data: ordenes, error } = await supabase

    .from("ordenes_compra")

    .select("id, estado")

    .in("id", uniqueOrdenIds);



  if (error) {

    return {

      ok: false,

      code: ORDER_ALREADY_HAS_CONTAINER,

      error: `No se pudieron validar las órdenes: ${error.message}`,

      status: 400,

    };

  }



  const foundIds = new Set(

    (ordenes ?? []).map((o) => (o as Record<string, unknown>)["id"] as string),

  );

  const missing = uniqueOrdenIds.filter((id) => !foundIds.has(id));

  if (missing.length > 0) {

    return {

      ok: false,

      code: ORDER_ALREADY_HAS_CONTAINER,

      error: `Órdenes no encontradas: ${missing.join(", ")}`,

      status: 404,

    };

  }



  const notConfirmadas = (ordenes ?? []).filter(

    (o) => (o as Record<string, unknown>)["estado"] !== "confirmado",

  );

  if (notConfirmadas.length > 0) {

    return {

      ok: false,

      code: ORDER_ALREADY_HAS_CONTAINER,

      error: "Solo se pueden vincular órdenes en estado confirmado",

      status: 400,

    };

  }



  const assignments = await fetchOrderContainerAssignments(supabase, uniqueOrdenIds);

  const ordenIdsToLink: string[] = [];



  for (const ordenId of uniqueOrdenIds) {

    const existing = assignments.find((row) => row.orden_id === ordenId);

    if (!existing) {

      ordenIdsToLink.push(ordenId);

      continue;

    }



    if (

      options.targetContenedorId

      && existing.contenedor_id === options.targetContenedorId

    ) {

      continue;

    }



    return {

      ok: false,

      code: ORDER_ALREADY_HAS_CONTAINER,

      error: `La orden ya está vinculada al contenedor ${existing.identificador_embarque}. No se puede crear otro contenedor para la misma orden.`,

      status: 409,

    };

  }



  return { ok: true, ordenIdsToLink };

}



export async function linkOrdersToContainer(

  supabase: SupabaseClient,

  contenedorId: string,

  ordenIds: string[],

): Promise<{ ok: true } | { ok: false; code: string; error: string; status: number }> {

  const validation = await validateOrdersForContainerLink(supabase, ordenIds, {

    targetContenedorId: contenedorId,

  });

  if (validation.ok === false) {

    return validation;

  }



  if (validation.ordenIdsToLink.length === 0) {

    return { ok: true };

  }



  const links = validation.ordenIdsToLink.map((ordenId) => ({

    contenedor_id: contenedorId,

    orden_id:      ordenId,

  }));



  const { error } = await supabase.from("contenedor_ordenes").insert(links);

  if (error) {

    const isUniqueViolation = error.message.toLowerCase().includes("unique")

      || error.code === "23505";

    return {

      ok: false,

      code: ORDER_ALREADY_HAS_CONTAINER,

      error: isUniqueViolation

        ? "La orden ya está vinculada a otro contenedor."

        : `No se vincularon las órdenes al contenedor: ${error.message}`,

      status: isUniqueViolation ? 409 : 400,

    };

  }



  return { ok: true };

}



export async function deleteContainerById(

  supabase: SupabaseClient,

  contenedorId: string,

): Promise<{ ok: true } | { ok: false; error: string }> {

  const { error } = await supabase.from("contenedores").delete().eq("id", contenedorId);

  if (error) {

    return { ok: false, error: error.message };

  }

  return { ok: true };

}



/**
 * Elimina los vínculos contenedor_ordenes y después el contenedor.
 *
 * Orden de operaciones:
 *   1. DELETE contenedor_ordenes WHERE contenedor_id = id  (vínculos)
 *   2. DELETE contenedores WHERE id = id                   (contenedor)
 *
 * ADVERTENCIA: estas dos operaciones NO se ejecutan en una transacción real.
 * Si el paso 1 falla silenciosamente (Supabase no devuelve error en DELETE vacío)
 * y el paso 2 falla, la función devuelve el error del paso 2.
 * Si el paso 1 falla y el paso 2 tiene éxito, los vínculos pueden quedar huérfanos.
 * Para eliminar ese riesgo en producción, añadir FK ON DELETE CASCADE en la BD
 * o migrar a una función RPC transaccional.
 *
 * El comportamiento actual mantiene la misma lógica que el handler original.
 */
export async function deleteContainerWithLinks(

  supabase: SupabaseClient,

  contenedorId: string,

): Promise<{ ok: true } | { ok: false; error: string }> {

  await supabase.from("contenedor_ordenes").delete().eq("contenedor_id", contenedorId);

  const { error } = await supabase.from("contenedores").delete().eq("id", contenedorId);

  if (error) return { ok: false, error: error.message };

  return { ok: true };

}


