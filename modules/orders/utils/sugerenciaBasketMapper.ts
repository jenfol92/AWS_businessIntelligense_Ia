import type { DraftBasketItem } from "@/modules/orders/types/draftBasket.types";

export type SugerenciaForBasket = {
  producto_id: string;
  sku: string;
  nombre: string;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  cbm_unitario: number;
  cbm_total_sugerido: number;
  coste_unitario_usd: number | null;
  unidades_sugeridas: number;
  agente_id?: string | null;
  agente_nombre?: string | null;
  origin_port_name?: string | null;
  puerto_preferido?: string | null;
  capital_requerido?: number | null;
};

export function sugerenciaToBasketItem(s: SugerenciaForBasket): DraftBasketItem {
  const port = s.origin_port_name ?? s.puerto_preferido ?? null;
  return {
    producto_id: s.producto_id,
    sku: s.sku,
    nombre: s.nombre,
    proveedor_id: s.proveedor_id,
    proveedor_nombre: s.proveedor_nombre,
    cbm_unitario: s.cbm_unitario,
    coste_unitario_usd: s.coste_unitario_usd,
    unidades_sugeridas: s.unidades_sugeridas,
    agente_id: s.agente_id ?? null,
    agente_contacto: s.agente_nombre ?? null,
    fob_puerto: port,
    capital_total: s.capital_requerido ?? null,
    cbm_total: s.cbm_total_sugerido,
    port_display: port,
    agent_display: s.agente_nombre ?? null,
    supplier_display: s.proveedor_nombre,
  };
}
