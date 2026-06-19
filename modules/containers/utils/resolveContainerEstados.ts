import type {
  EstadoContenedor,
  EstadoCostesContenedor,
  EstadoLogisticoContenedor,
  EstadoStockContenedor,
  TipoContenedor,
} from "../constants/estadoContenedor";
import {
  isEstadoCostesContenedor,
  isEstadoLogisticoContenedor,
  isEstadoStockContenedor,
  isTipoContenedor,
} from "../constants/estadoContenedor";

export type ContainerEstadosRow = {
  estado?: string | null;
  estado_logistico?: string | null;
  estado_stock?: string | null;
  estado_costes?: string | null;
  tipo_contenedor?: string | null;
};

export type ResolvedContainerEstados = {
  estado_logistico: EstadoLogisticoContenedor;
  estado_stock: EstadoStockContenedor;
  estado_costes: EstadoCostesContenedor;
  tipo_contenedor: TipoContenedor;
  /** Legacy sincronizado para compatibilidad. */
  estado: EstadoContenedor;
};

/** Mapeo orientativo legacy → estados separados. */
export function mapLegacyEstadoToSeparated(estado: string): Pick<
  ResolvedContainerEstados,
  "estado_logistico" | "estado_stock" | "estado_costes"
> {
  switch (estado) {
    case "borrador":
    case "preparando":
    case "en_puerto_salida":
    case "en_transito":
    case "en_puerto_destino":
    case "entregado":
      return {
        estado_logistico: estado,
        estado_stock: "pendiente_stock",
        estado_costes: "costes_estimados",
      };
    case "disponible_stock":
      return {
        estado_logistico: "entregado",
        estado_stock: "disponible_stock",
        estado_costes: "costes_estimados",
      };
    case "facturado":
      return {
        estado_logistico: "entregado",
        estado_stock: "disponible_stock",
        estado_costes: "costes_facturados",
      };
    default:
      return {
        estado_logistico: "borrador",
        estado_stock: "pendiente_stock",
        estado_costes: "costes_estimados",
      };
  }
}

/** Sincroniza estado legacy desde los tres ejes. */
export function syncLegacyEstadoFromSeparated(params: {
  estado_logistico: EstadoLogisticoContenedor;
  estado_stock: EstadoStockContenedor;
  estado_costes: EstadoCostesContenedor;
}): EstadoContenedor {
  if (
    params.estado_costes === "costes_facturados" &&
    params.estado_stock === "disponible_stock"
  ) {
    return "facturado";
  }
  if (params.estado_stock === "disponible_stock") {
    return "disponible_stock";
  }
  if (params.estado_logistico === "entregado") {
    return "entregado";
  }
  return params.estado_logistico;
}

export function normalizeTipoContenedorValue(
  tipo: string | null | undefined,
): TipoContenedor {
  const t = String(tipo ?? "").trim().toLowerCase();
  if (t === "amazon_agl" || t === "agl" || t === "agc") return "amazon_agl";
  return "propio";
}

/** Resuelve estados efectivos; fallback desde legacy si faltan columnas nuevas. */
export function resolveContainerEstados(
  row: ContainerEstadosRow,
): ResolvedContainerEstados {
  const legacy = row.estado ?? "borrador";
  const fromLegacy = mapLegacyEstadoToSeparated(legacy);

  const estado_logistico = isEstadoLogisticoContenedor(row.estado_logistico)
    ? row.estado_logistico
    : fromLegacy.estado_logistico;

  const estado_stock = isEstadoStockContenedor(row.estado_stock)
    ? row.estado_stock
    : fromLegacy.estado_stock;

  const estado_costes = isEstadoCostesContenedor(row.estado_costes)
    ? row.estado_costes
    : fromLegacy.estado_costes;

  const tipo_contenedor = isTipoContenedor(row.tipo_contenedor)
    ? row.tipo_contenedor
    : normalizeTipoContenedorValue(row.tipo_contenedor);

  const estado = syncLegacyEstadoFromSeparated({
    estado_logistico,
    estado_stock,
    estado_costes,
  });

  return {
    estado_logistico,
    estado_stock,
    estado_costes,
    tipo_contenedor,
    estado,
  };
}
