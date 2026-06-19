import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isEstadoLogisticoContenedor,
} from "@/modules/containers/constants/estadoContenedor";
import {
  deleteContainerById,
  linkOrdersToContainer,
  validateOrdersForContainerLink,
} from "@/modules/containers/repositories/containerOrdersRepository";
import {
  enrichCreatePayloadFromOrderFields,
  resolveContainerFieldsFromOrders,
} from "@/modules/containers/services/propagateOrderFieldsToContainer";
import type { CreateContainerFromOrderPayload } from "@/modules/containers/types/createContainer.types";
import {
  buildContainerEstadosUpdate,
  defaultContainerEstadosForCreate,
} from "@/modules/containers/utils/buildContainerEstadosUpdate";
import { normalizeTipoContenedorValue } from "@/modules/containers/utils/resolveContainerEstados";
import { refreshSupplierPaymentsFromContainer } from "@/modules/finance/services/syncSupplierPaymentsForOrder";

export type CreateContainerWithOrdersResult =
  | { ok: true; contenedor: Record<string, unknown> }
  | { ok: false; error: string; code?: string; status: number };

export async function createContainerWithOrders(
  supabase: SupabaseClient,
  userId: string,
  body: CreateContainerFromOrderPayload,
): Promise<CreateContainerWithOrdersResult> {
  if (!body.identificador_embarque?.trim()) {
    return { ok: false, error: "El numero de embarque es obligatorio", status: 400 };
  }

  const estadoLogisticoInicial =
    body.estado_logistico ??
    (body.estado && isEstadoLogisticoContenedor(body.estado) ? body.estado : null) ??
    "borrador";

  if (!isEstadoLogisticoContenedor(estadoLogisticoInicial)) {
    return {
      ok: false,
      error: `Estado logístico no válido: ${estadoLogisticoInicial}`,
      status: 400,
    };
  }

  const estadosIniciales = defaultContainerEstadosForCreate(estadoLogisticoInicial);
  if (body.estado_stock != null) {
    const built = buildContainerEstadosUpdate({}, { estado_stock: body.estado_stock });
    if (built.errors.length > 0) {
      return { ok: false, error: built.errors.join("; "), status: 400 };
    }
    estadosIniciales.estado_stock = built.payload.estado_stock;
  }
  if (body.estado_costes != null) {
    const built = buildContainerEstadosUpdate({}, { estado_costes: body.estado_costes });
    if (built.errors.length > 0) {
      return { ok: false, error: built.errors.join("; "), status: 400 };
    }
    estadosIniciales.estado_costes = built.payload.estado_costes;
  }
  estadosIniciales.estado = buildContainerEstadosUpdate(estadosIniciales, {}).payload.estado;

  const tipoContenedor = body.tipo_contenedor
    ? normalizeTipoContenedorValue(body.tipo_contenedor)
    : "propio";

  const ordenIds = Array.from(
    new Set((body.orden_ids ?? []).map((id) => id.trim()).filter(Boolean)),
  );

  const orderValidation = await validateOrdersForContainerLink(supabase, ordenIds);
  if (orderValidation.ok === false) {
    return {
      ok: false,
      error: orderValidation.error,
      code: orderValidation.code,
      status: orderValidation.status,
    };
  }

  let insertPayload = {
    identificador_embarque: body.identificador_embarque.trim(),
    tipo_contenedor:        tipoContenedor,
    transitario:            body.transitario        ?? null,
    puerto_salida:          body.puerto_salida      ?? null,
    puerto_llegada:         body.puerto_llegada     ?? null,
    fecha_salida:           body.fecha_salida       ?? null,
    fecha_eta_estimada:     body.fecha_eta_estimada ?? null,
    estado:                    estadosIniciales.estado,
    estado_logistico:          estadosIniciales.estado_logistico,
    estado_stock:              estadosIniciales.estado_stock,
    estado_costes:             estadosIniciales.estado_costes,
    notas:                     body.notas                     ?? null,
    costo_flete_total_eur:     body.costo_flete_total_eur     ?? null,
    gastos_llegada_puerto_eur: body.gastos_llegada_puerto_eur ?? null,
    created_by:             userId,
    updated_by:             userId,
  };

  if (ordenIds.length > 0) {
    const fromOrders = await resolveContainerFieldsFromOrders(supabase, ordenIds);
    insertPayload = enrichCreatePayloadFromOrderFields(insertPayload, fromOrders);
  }

  const { data: contenedor, error: insError } = await supabase
    .from("contenedores")
    .insert(insertPayload)
    .select("*")
    .single();

  if (insError || !contenedor) {
    return {
      ok: false,
      error: insError?.message ?? "Error al crear contenedor",
      status: 500,
    };
  }

  const contenedorId = (contenedor as Record<string, unknown>)["id"] as string;
  const linkResult = await linkOrdersToContainer(supabase, contenedorId, ordenIds);
  if (linkResult.ok === false) {
    const rollback = await deleteContainerById(supabase, contenedorId);
    const rollbackSuffix =
      rollback.ok === false
        ? ` (rollback del contenedor falló: ${rollback.error})`
        : "";
    return {
      ok: false,
      error: `${linkResult.error}${rollbackSuffix}`,
      code: linkResult.code,
      status: linkResult.status,
    };
  }

  try {
    await refreshSupplierPaymentsFromContainer(supabase, contenedorId);
  } catch (syncError) {
    console.error("refreshSupplierPaymentsFromContainer:", syncError);
  }

  return { ok: true, contenedor: contenedor as Record<string, unknown> };
}
