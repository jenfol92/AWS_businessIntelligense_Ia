export type StockCanal = "FBA" | "FBM";

export type ContenedorStockDestinoRow = {
  id: string;
  contenedor_id: string;
  orden_item_id: string;
  producto_id: string;
  pais: string;
  canal: StockCanal;
  marketplace_id: string | null;
  cantidad: number;
  notas: string | null;
};

export type OrdenItemForContainerRow = {
  id: string;
  orden_id: string;
  producto_id: string;
  cantidad: number;
  cbm_unitario: number | null;
  cbm_total: number | null;
  coste_unitario_eur: number | null;
  lote_producto: string | null;
};

export type ContainerRowForStock = {
  id: string;
  identificador_embarque: string;
  estado: string;
  tipo_contenedor: string | null;
  costo_flete_total_eur: number | null;
  gastos_llegada_puerto_eur: number | null;
  costo_transito_total_eur: number | null;
  comision_bancaria_eur: number | null;
  /** Legacy fallback — no usar si existe el campo moderno. */
  flete: number | null;
  gastos_llegada_puerto: number | null;
};

export type CbmCostAllocationLine = {
  ordenItemId: string;
  productoId: string;
  cantidad: number;
  cbmTotal: number;
  costeFleteUnitario: number;
  costePuertoUnitario: number;
  costeTransitoUnitario: number;
  costeBancoUnitario: number;
  costeLogisticoUnitarioTotal: number;
};

export type ContainerCbmCostAllocation = {
  cbmTotalContenedor: number;
  lineas: CbmCostAllocationLine[];
};

export type ApplyContainerStockResult = {
  triggered: boolean;
  applied: boolean;
  reason?: string;
  warnings?: string[];
  summary?: {
    linesApplied: number;
    totalUnits: number;
  };
  costAllocation?: ContainerCbmCostAllocation;
};

export type ContainerStockOperationalStatus = {
  stockApplied: boolean;
  destinationsDefined: boolean;
  costsProrated: boolean;
  tipoContenedor: string | null;
  activeStockLines: number;
  destinationLines: number;
  costRecords: number;
};
