/**
 * Cliente API para los catálogos auxiliares del formulario de órdenes de compra.
 * Centraliza acceso a agentes de compra sin importar desde app/api.
 */

export type PurchasingAgent = {
  id: string;
  contacto: string | null;
};

/**
 * Carga la lista de agentes de compra desde GET /api/purchasing-agents.
 * Nunca lanza: devuelve array vacío si falla para no bloquear la UI.
 */
export async function fetchPurchasingAgents(): Promise<PurchasingAgent[]> {
  try {
    const res  = await fetch("/api/purchasing-agents");
    const json = await res.json();
    if (json.ok) return json.rows ?? [];
  } catch {
    // No bloquear la UI si falla la carga de agentes
  }
  return [];
}
