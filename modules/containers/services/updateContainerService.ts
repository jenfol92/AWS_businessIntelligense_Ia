/**
 * Módulo      : containers
 * Archivo     : services/updateContainerService.ts
 * Responsabilidad: orquestación de la actualización de un contenedor:
 *                  validación de estados, concatenación de notas, persistencia
 *                  y disparo del hook de stock si el estado_stock cambia.
 * No debe     : gestionar autenticación ni respuestas HTTP.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { applyStockAndCostsOnEstadoChange } from "@/modules/containers/services/applyStockAndCostsOnEstadoChange";
import {
  fetchContainerCurrentState,
  updateContainerRecord,
} from "@/modules/containers/repositories/containersRepository";
import {
  buildContainerEstadosUpdate,
} from "@/modules/containers/utils/buildContainerEstadosUpdate";
import {
  normalizeTipoContenedorValue,
  resolveContainerEstados,
} from "@/modules/containers/utils/resolveContainerEstados";
import type { UpdateContainerBody } from "@/modules/containers/types/updateContainer.types";

export type UpdateContainerResult =
  | {
      ok: true;
      contenedor: Record<string, unknown>;
      stockActivation: Record<string, unknown>;
    }
  | { ok: false; error: string; status: number };

/**
 * Actualiza los campos indicados de un contenedor.
 * Gestiona la concatenación de notas (appendNota), la resolución de estados
 * y el hook de activación de stock si el estado_stock cambia.
 *
 * @param supabase     - Cliente Supabase autenticado.
 * @param contenedorId - ID del contenedor a actualizar.
 * @param body         - Campos a actualizar (ver UpdateContainerBody).
 * @param userId       - ID del usuario que realiza la actualización.
 */
export async function updateContainerService(
  supabase: SupabaseClient,
  contenedorId: string,
  body: UpdateContainerBody,
  userId: string,
): Promise<UpdateContainerResult> {
  const {
    appendNota,
    notas: notasDirectas,
    estado,
    estado_logistico,
    estado_stock,
    estado_costes,
    tipo_contenedor,
    ...rest
  } = body;

  const actualContenedor = await fetchContainerCurrentState(supabase, contenedorId);
  if (!actualContenedor) {
    return { ok: false, error: "Contenedor no encontrado", status: 404 };
  }

  const previousEstadoStock = resolveContainerEstados(actualContenedor).estado_stock;

  const estadosBuilt = buildContainerEstadosUpdate(actualContenedor, {
    estado,
    estado_logistico,
    estado_stock,
    estado_costes,
    tipo_contenedor,
  });

  if (estadosBuilt.errors.length > 0) {
    return { ok: false, error: estadosBuilt.errors.join("; "), status: 400 };
  }

  const estadosPayload = estadosBuilt.payload;

  // Concatenar appendNota al historial sin pisar notas anteriores
  let notasFinal: string | null | undefined = notasDirectas;
  if (appendNota) {
    const notasActuales = (actualContenedor["notas"] as string | null) ?? "";
    notasFinal = notasActuales ? `${notasActuales}\n${appendNota}` : appendNota;
  }

  const updatePayload: Record<string, unknown> = {
    ...rest,
    estado: estadosPayload.estado,
    estado_logistico: estadosPayload.estado_logistico,
    estado_stock: estadosPayload.estado_stock,
    estado_costes: estadosPayload.estado_costes,
    tipo_contenedor:
      tipo_contenedor != null
        ? normalizeTipoContenedorValue(tipo_contenedor)
        : estadosPayload.tipo_contenedor,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  if (notasFinal !== undefined) updatePayload["notas"] = notasFinal;

  const { data: cont, error } = await updateContainerRecord(supabase, contenedorId, updatePayload);
  if (error || !cont) {
    return { ok: false, error: error ?? "Error al actualizar contenedor", status: 400 };
  }

  // Disparar hook de stock solo si el estado_stock cambia
  const newEstadoStock = estadosPayload.estado_stock;
  const stockActivation =
    estado_stock != null && estado_stock !== previousEstadoStock
      ? await applyStockAndCostsOnEstadoChange(
          contenedorId,
          previousEstadoStock,
          newEstadoStock,
          estadosPayload.tipo_contenedor,
          { userId },
        )
      : { triggered: false, applied: false };

  return {
    ok: true,
    contenedor: {
      ...cont,
      estadosResueltos: resolveContainerEstados(cont),
    },
    stockActivation: stockActivation as Record<string, unknown>,
  };
}
