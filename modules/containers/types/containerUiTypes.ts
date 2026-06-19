import type { EstadoContenedor } from "@/modules/containers/constants/estadoContenedor";

/** Orden vinculada (resumen) dentro del listado de contenedores. */
export type OrdenResumen = {
  id:              string;
  numero_orden:    string;
  agente_id:       string | null;
  agente_contacto: string | null;
  coste_total_eur: number;
  cbm_total:       number;
};

/** Fila de contenedor tal como devuelve GET /api/containers. */
export type ContenedorRow = {
  id:                        string;
  identificador_embarque:    string;
  tipo_contenedor:           string | null;
  transitario:               string | null;
  puerto_salida:             string | null;
  puerto_llegada:            string | null;
  fecha_salida:              string | null;
  fecha_eta_estimada:        string | null;
  estado:                    string;
  estado_logistico:          string | null;
  estado_stock:              string | null;
  estado_costes:             string | null;
  notas:                     string | null;
  costo_flete_total_eur:     number | null;
  gastos_llegada_puerto_eur: number | null;
  costo_transito_total_eur:  number | null;
  coste_total_eur:           number;
  cbm_total:                 number;
  ordenes_count:             number;
  agente_contacto:           string | null;
  destino_label?:            string | null;
  destino_badge?:            string | null;
  ordenes:                   OrdenResumen[];
};

/** Ítem de orden dentro del detalle expandido. */
export type OrdenItem = {
  id:               string;
  producto_id:      string;
  cantidad:         number;
  cbm_total:        number;
  coste_unitario_usd: number | null;
  lote_producto:    string | null;
  productos: { sku: string; nombre: string; producto_detalle?: Array<{ imagen_url: string | null }> } | null;
};

/** Orden completa dentro del detalle expandido. */
export type OrdenDetalle = {
  id:                   string;
  numero_orden:         string;
  numero_pedido_agente: string | null;
  agente_id:            string | null;
  agente_contacto:      string | null;
  fob_puerto:           string | null;
  destino:              string | null;
  etd:                  string | null;
  eta:                  string | null;
  coste_total_eur:      number;
  cbm_total:            number;
  proforma_firmada_url: string | null;
  items:                OrdenItem[];
};

/** Pestaña dentro del panel de detalle expandido. */
export type DetallePestaña = "editar" | "ordenes" | "documentos";

/** Filtro de estado del listado. */
export type EstadoFiltro = "ALL" | EstadoContenedor;

/** Estado operativo stock/costes del contenedor (GET /api/containers/[id]). */
export type ContainerStockStatus = {
  stockApplied: boolean;
  destinationsDefined: boolean;
  costsProrated: boolean;
  tipoContenedor: string | null;
  activeStockLines: number;
  destinationLines: number;
  costRecords: number;
};

export type FacturarResultLinea = {
  sku: string | null;
  producto: string | null;
  cantidad: number;
  cbm_total: number;
  peso_cbm: number;
  costo_unitario_total_eur: number;
};
