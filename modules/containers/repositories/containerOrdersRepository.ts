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

      `contenedor_id, orden_id,
       ordenes_compra(
         id, numero_orden, numero_pedido_agente, agente_id,
         moneda_compra, coste_total_eur, tipo_cambio_moneda_eur,
         cbm_total, fob_puerto, destino, eta,
         orden_items(cantidad, coste_unitario_moneda),
         agentes_compra(contacto)
       )`,

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

  const { data: logisticsAssignments, error: logisticsError } = await supabase
    .from("orden_logistics_assignments")
    .select("orden_id, assignment_type, shipment_id, contenedor_id")
    .in("orden_id", uniqueOrdenIds)
    .eq("status", "active");

  if (logisticsError) {
    return {
      ok: false,
      code: ORDER_ALREADY_HAS_CONTAINER,
      error: `No se pudo validar la logistica activa de las ordenes: ${logisticsError.message}`,
      status: 400,
    };
  }

  const ordenIdsToLink: string[] = [];



  for (const ordenId of uniqueOrdenIds) {

    const activeLogistics = (logisticsAssignments ?? []).find(
      (row) => (row as Record<string, unknown>)["orden_id"] === ordenId,
    ) as Record<string, unknown> | undefined;

    if (activeLogistics) {
      const assignmentType = String(activeLogistics["assignment_type"] ?? "");
      const assignedContainerId = String(activeLogistics["contenedor_id"] ?? "");

      if (
        assignmentType === "contenedor_propio" &&
        options.targetContenedorId &&
        assignedContainerId === options.targetContenedorId
      ) {
        continue;
      }

      if (assignmentType === "amazon_inbound") {
        return {
          ok: false,
          code: ORDER_ALREADY_HAS_CONTAINER,
          error:
            "La orden ya tiene un shipment Amazon inbound activo. Desvincula esa logistica antes de vincular un contenedor propio.",
          status: 409,
        };
      }

      if (assignmentType && assignmentType !== "contenedor_propio") {
        return {
          ok: false,
          code: ORDER_ALREADY_HAS_CONTAINER,
          error: `La orden ya tiene una logistica activa (${assignmentType}). Desvinculala antes de vincular un contenedor propio.`,
          status: 409,
        };
      }
    }

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

  const assignmentRows = validation.ordenIdsToLink.map((ordenId) => ({
    orden_id: ordenId,
    assignment_type: "contenedor_propio",
    contenedor_id: contenedorId,
    shipment_id: null,
    status: "active",
  }));

  const { error: assignmentError } = await supabase
    .from("orden_logistics_assignments")
    .insert(assignmentRows);

  if (assignmentError) {
    return {
      ok: false,
      code: ORDER_ALREADY_HAS_CONTAINER,
      error: `El contenedor se vinculo, pero no se pudo registrar la logistica activa: ${assignmentError.message}`,
      status: 400,
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
  const { error: linksError } = await supabase
    .from("contenedor_ordenes")
    .delete()
    .eq("contenedor_id", contenedorId);

  if (linksError) {
    return {
      ok: false,
      error: `No se pudieron eliminar los vínculos del contenedor: ${linksError.message}`,
    };
  }

  const { error: containerError } = await supabase
    .from("contenedores")
    .delete()
    .eq("id", contenedorId);

  if (containerError) {
    return {
      ok: false,
      error: `No se pudo eliminar el contenedor: ${containerError.message}`,
    };
  }

  return { ok: true };
}

export async function deleteContainerWithConfirmation(
  supabase: SupabaseClient,
  contenedorId: string,
  options: { unlinkAssignedOrders?: boolean } = {},
): Promise<
  | { ok: true; deletedContainerId?: string; unlinkedOrders?: number }
  | {
      ok: false;
      error: string;
      status?: number;
      requiresConfirmation?: boolean;
      assignedOrders?: Array<{
        id: string;
        numero_orden: string | null;
        numero_pedido_agente: string | null;
      }>;
    }
> {
  const { data, error } = await supabase.rpc("delete_container_unlink_orders", {
    p_contenedor_id: contenedorId,
    p_unlink_assigned_orders: options.unlinkAssignedOrders === true,
  });

  if (error) {
    return {
      ok: false,
      error: `No se pudo eliminar el contenedor: ${error.message}`,
      status: 400,
    };
  }

  const result = (data ?? {}) as Record<string, unknown>;
  if (result.ok === true) {
    return {
      ok: true,
      deletedContainerId: String(result.deletedContainerId ?? contenedorId),
      unlinkedOrders: Number(result.unlinkedOrders ?? 0),
    };
  }

  const assignedOrders = Array.isArray(result.assignedOrders)
    ? result.assignedOrders.map((row) => {
        const item = row as Record<string, unknown>;
        return {
          id: String(item.id ?? ""),
          numero_orden: item.numero_orden != null ? String(item.numero_orden) : null,
          numero_pedido_agente:
            item.numero_pedido_agente != null ? String(item.numero_pedido_agente) : null,
        };
      })
    : [];

  return {
    ok: false,
    error: String(result.message ?? result.error ?? "No se pudo eliminar el contenedor."),
    status: Number(result.status ?? (result.requiresConfirmation ? 409 : 400)),
    requiresConfirmation: result.requiresConfirmation === true,
    assignedOrders,
  };
}

