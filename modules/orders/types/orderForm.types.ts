/**
 * Tipos del formulario de orden de compra.
 * Separados del componente para evitar que utils/hooks dependan de components.
 */

/**
 * Producto precargado desde la pestaña Sugerencias.
 * Contiene los campos mínimos para construir un OrderItem sin búsqueda manual.
 */
export type PreloadedItem = {
  producto_id: string;
  sku: string;
  nombre: string;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  cbm_unitario: number;
  coste_unitario_usd: number | null;
  /** Cantidad inicial sugerida; si no viene, se usa 1. */
  unidades_sugeridas?: number;
  /** Agente sugerido por planner/proveedor. */
  agente_id?: string | null;
  agente_contacto?: string | null;
  /**
   * Puerto FOB de origen como texto legible (p.ej. "Ningbo").
   * Cuando todos los ítems precargados comparten el mismo puerto,
   * se preselecciona automáticamente en el campo fob_puerto del formulario.
   * Nunca debe contener un UUID.
   */
  fob_puerto?: string | null;
};
