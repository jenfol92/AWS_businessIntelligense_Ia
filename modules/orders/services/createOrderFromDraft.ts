/**
 * Módulo      : orders
 * Archivo     : services/createOrderFromDraft.ts
 * Responsabilidad: Thin wrapper de autenticación sobre createOrderDraftService.
 *   1. Resuelve el usuario autenticado actual (created_by).
 *   2. Delega toda la orquestación y persistencia en createOrderDraftService.
 *
 * Los tipos CreateOrderFromDraftResult y OrderCreateErrorCode se definen en
 * createOrderDraftService.ts y se re-exportan aquí para compatibilidad con
 * importadores existentes (e.g. app/api/orders/create-from-planner/route.ts).
 */

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import {
  createOrderDraftService,
  type CreateOrderFromDraftResult,
} from "@/modules/orders/services/createOrderDraftService";
import type { OrderDraft } from "@/modules/orders/types/order.types";

// Re-exportar tipos para compatibilidad con importadores existentes.
export type {
  CreateOrderFromDraftResult,
  OrderCreateErrorCode,
} from "@/modules/orders/services/createOrderDraftService";

/**
 * Persiste un OrderDraft como orden borrador en Supabase.
 *
 * Resuelve el usuario de la sesión activa para el campo created_by y delega
 * toda la lógica de negocio y persistencia en createOrderDraftService.
 *
 * @param draft - El borrador in-memory producido por createOrderDraftFromGroup.
 * @returns CreateOrderFromDraftResult — unión discriminada ok/error.
 */
export async function createOrderFromDraft(
  draft: OrderDraft,
): Promise<CreateOrderFromDraftResult> {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return createOrderDraftService(draft, user?.id ?? null);
}
