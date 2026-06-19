import {
  isEstadoCostesContenedor,
  isEstadoLogisticoContenedor,
  isEstadoStockContenedor,
  type EstadoCostesContenedor,
  type EstadoLogisticoContenedor,
  type EstadoStockContenedor,
  type TipoContenedor,
} from "../constants/estadoContenedor";
import {
  mapLegacyEstadoToSeparated,
  normalizeTipoContenedorValue,
  resolveContainerEstados,
  syncLegacyEstadoFromSeparated,
  type ContainerEstadosRow,
} from "./resolveContainerEstados";

export type ContainerEstadosUpdateInput = {
  estado?: string | null;
  estado_logistico?: string | null;
  estado_stock?: string | null;
  estado_costes?: string | null;
  tipo_contenedor?: string | null;
};

export type ContainerEstadosUpdatePayload = {
  estado_logistico: EstadoLogisticoContenedor;
  estado_stock: EstadoStockContenedor;
  estado_costes: EstadoCostesContenedor;
  tipo_contenedor: TipoContenedor;
  estado: string;
};

export function buildContainerEstadosUpdate(
  current: ContainerEstadosRow,
  input: ContainerEstadosUpdateInput,
): { payload: ContainerEstadosUpdatePayload; errors: string[] } {
  const resolved = resolveContainerEstados(current);
  const errors: string[] = [];

  let estado_logistico = resolved.estado_logistico;
  let estado_stock = resolved.estado_stock;
  let estado_costes = resolved.estado_costes;
  let tipo_contenedor = resolved.tipo_contenedor;

  if (input.estado_logistico != null) {
    if (!isEstadoLogisticoContenedor(input.estado_logistico)) {
      errors.push(`estado_logistico no válido: ${input.estado_logistico}`);
    } else {
      estado_logistico = input.estado_logistico;
    }
  }

  if (input.estado_stock != null) {
    if (!isEstadoStockContenedor(input.estado_stock)) {
      errors.push(`estado_stock no válido: ${input.estado_stock}`);
    } else {
      estado_stock = input.estado_stock;
    }
  }

  if (input.estado_costes != null) {
    if (!isEstadoCostesContenedor(input.estado_costes)) {
      errors.push(`estado_costes no válido: ${input.estado_costes}`);
    } else {
      estado_costes = input.estado_costes;
    }
  }

  if (input.tipo_contenedor != null) {
    tipo_contenedor = normalizeTipoContenedorValue(input.tipo_contenedor);
  }

  if (
    input.estado != null &&
    input.estado_logistico == null &&
    input.estado_stock == null &&
    input.estado_costes == null
  ) {
    const mapped = mapLegacyEstadoToSeparated(input.estado);
    estado_logistico = mapped.estado_logistico;
    estado_stock = mapped.estado_stock;
    estado_costes = mapped.estado_costes;
  }

  const estado = syncLegacyEstadoFromSeparated({
    estado_logistico,
    estado_stock,
    estado_costes,
  });

  return {
    payload: {
      estado_logistico,
      estado_stock,
      estado_costes,
      tipo_contenedor,
      estado,
    },
    errors,
  };
}

export function defaultContainerEstadosForCreate(
  estadoLogistico: EstadoLogisticoContenedor = "borrador",
): ContainerEstadosUpdatePayload {
  const estado_stock: EstadoStockContenedor = "pendiente_stock";
  const estado_costes: EstadoCostesContenedor = "costes_estimados";
  return {
    estado_logistico: estadoLogistico,
    estado_stock,
    estado_costes,
    tipo_contenedor: "propio",
    estado: syncLegacyEstadoFromSeparated({
      estado_logistico: estadoLogistico,
      estado_stock,
      estado_costes,
    }),
  };
}
