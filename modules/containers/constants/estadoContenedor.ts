/** @deprecated Legacy — preferir estado_logistico + estado_stock + estado_costes. */
export type EstadoContenedor =
  | "borrador"
  | "preparando"
  | "en_puerto_salida"
  | "en_transito"
  | "en_puerto_destino"
  | "entregado"
  | "disponible_stock"
  | "facturado";

export type EstadoLogisticoContenedor =
  | "borrador"
  | "preparando"
  | "en_puerto_salida"
  | "en_transito"
  | "en_puerto_destino"
  | "entregado";

export type EstadoStockContenedor =
  | "pendiente_stock"
  | "parcialmente_disponible"
  | "disponible_stock"
  | "incidencia_stock";

export type EstadoCostesContenedor =
  | "costes_estimados"
  | "costes_facturados"
  | "costes_cerrados";

export type TipoContenedor = "propio" | "amazon_agl";

/** Stock disponible: activa aplicar stock solo en contenedores propios. */
export const ESTADO_STOCK_ACTIVA_APLICACION: EstadoStockContenedor =
  "disponible_stock";

export const ESTADOS_LOGISTICOS_ORDEN: EstadoLogisticoContenedor[] = [
  "borrador",
  "preparando",
  "en_puerto_salida",
  "en_transito",
  "en_puerto_destino",
  "entregado",
];

export const ESTADOS_STOCK_ORDEN: EstadoStockContenedor[] = [
  "pendiente_stock",
  "parcialmente_disponible",
  "disponible_stock",
  "incidencia_stock",
];

export const ESTADOS_COSTES_ORDEN: EstadoCostesContenedor[] = [
  "costes_estimados",
  "costes_facturados",
  "costes_cerrados",
];

export const TIPOS_CONTENEDOR_OPCIONES: TipoContenedor[] = [
  "propio",
  "amazon_agl",
];

/** @deprecated Legacy */
export const ESTADO_ACTIVA_STOCK_CONTENEDOR: EstadoContenedor = "disponible_stock";

/** @deprecated Legacy */
export const ESTADOS_CONTENEDOR_ORDEN: EstadoContenedor[] = [
  "borrador",
  "preparando",
  "en_puerto_salida",
  "en_transito",
  "en_puerto_destino",
  "entregado",
  "disponible_stock",
  "facturado",
];

export const ESTADO_LOGISTICO_LABELS: Record<EstadoLogisticoContenedor, string> = {
  borrador: "Borrador",
  preparando: "Preparando",
  en_puerto_salida: "En puerto salida",
  en_transito: "En tránsito",
  en_puerto_destino: "En puerto destino",
  entregado: "Entregado",
};

export const ESTADO_STOCK_LABELS: Record<EstadoStockContenedor, string> = {
  pendiente_stock: "Pendiente stock",
  parcialmente_disponible: "Parcialmente disponible",
  disponible_stock: "Disponible stock",
  incidencia_stock: "Incidencia stock",
};

export const ESTADO_COSTES_LABELS: Record<EstadoCostesContenedor, string> = {
  costes_estimados: "Costes estimados",
  costes_facturados: "Costes facturados",
  costes_cerrados: "Costes cerrados",
};

export const TIPO_CONTENEDOR_LABELS: Record<TipoContenedor, string> = {
  propio: "Propio",
  amazon_agl: "Amazon AGL",
};

/** @deprecated Legacy */
export const ESTADO_CONTENEDOR_LABELS: Record<EstadoContenedor, string> = {
  borrador: "Borrador",
  preparando: "Preparando",
  en_puerto_salida: "En puerto salida",
  en_transito: "En tránsito",
  en_puerto_destino: "En puerto destino",
  entregado: "Entregado",
  disponible_stock: "Disponible stock",
  facturado: "Facturado",
};

export const ESTADO_LOGISTICO_BADGE: Record<
  EstadoLogisticoContenedor,
  { bg: string; text: string }
> = {
  borrador: { bg: "bg-slate-100", text: "text-slate-500" },
  preparando: { bg: "bg-slate-100", text: "text-slate-600" },
  en_puerto_salida: { bg: "bg-blue-100", text: "text-blue-700" },
  en_transito: { bg: "bg-sky-100", text: "text-sky-700" },
  en_puerto_destino: { bg: "bg-amber-100", text: "text-amber-700" },
  entregado: { bg: "bg-emerald-100", text: "text-emerald-700" },
};

export const ESTADO_STOCK_BADGE: Record<
  EstadoStockContenedor,
  { bg: string; text: string }
> = {
  pendiente_stock: { bg: "bg-slate-100", text: "text-slate-600" },
  parcialmente_disponible: { bg: "bg-amber-100", text: "text-amber-700" },
  disponible_stock: { bg: "bg-green-100", text: "text-green-800" },
  incidencia_stock: { bg: "bg-red-100", text: "text-red-700" },
};

export const ESTADO_COSTES_BADGE: Record<
  EstadoCostesContenedor,
  { bg: string; text: string }
> = {
  costes_estimados: { bg: "bg-slate-100", text: "text-slate-600" },
  costes_facturados: { bg: "bg-indigo-100", text: "text-indigo-700" },
  costes_cerrados: { bg: "bg-violet-100", text: "text-violet-700" },
};

/** @deprecated Legacy */
export const ESTADO_CONTENEDOR_BADGE: Record<
  EstadoContenedor,
  { bg: string; text: string }
> = {
  borrador: ESTADO_LOGISTICO_BADGE.borrador,
  preparando: ESTADO_LOGISTICO_BADGE.preparando,
  en_puerto_salida: ESTADO_LOGISTICO_BADGE.en_puerto_salida,
  en_transito: ESTADO_LOGISTICO_BADGE.en_transito,
  en_puerto_destino: ESTADO_LOGISTICO_BADGE.en_puerto_destino,
  entregado: ESTADO_LOGISTICO_BADGE.entregado,
  disponible_stock: ESTADO_STOCK_BADGE.disponible_stock,
  facturado: ESTADO_COSTES_BADGE.costes_facturados,
};

export const ESTADOS_LOGISTICOS_OPCIONES = ESTADOS_LOGISTICOS_ORDEN.map((value) => ({
  value,
  label: ESTADO_LOGISTICO_LABELS[value],
}));

export const ESTADOS_STOCK_OPCIONES = ESTADOS_STOCK_ORDEN.map((value) => ({
  value,
  label: ESTADO_STOCK_LABELS[value],
}));

export const ESTADOS_COSTES_OPCIONES = ESTADOS_COSTES_ORDEN.map((value) => ({
  value,
  label: ESTADO_COSTES_LABELS[value],
}));

export const TIPOS_CONTENEDOR_LABELS_OPCIONES = TIPOS_CONTENEDOR_OPCIONES.map(
  (value) => ({
    value,
    label: TIPO_CONTENEDOR_LABELS[value],
  }),
);

/** @deprecated Legacy */
export const ESTADOS_CONTENEDOR_OPCIONES = ESTADOS_CONTENEDOR_ORDEN.map((value) => ({
  value,
  label: ESTADO_CONTENEDOR_LABELS[value],
}));

export function isEstadoLogisticoContenedor(
  value: string | null | undefined,
): value is EstadoLogisticoContenedor {
  return (ESTADOS_LOGISTICOS_ORDEN as string[]).includes(String(value ?? ""));
}

export function isEstadoStockContenedor(
  value: string | null | undefined,
): value is EstadoStockContenedor {
  return (ESTADOS_STOCK_ORDEN as string[]).includes(String(value ?? ""));
}

export function isEstadoCostesContenedor(
  value: string | null | undefined,
): value is EstadoCostesContenedor {
  return (ESTADOS_COSTES_ORDEN as string[]).includes(String(value ?? ""));
}

export function isTipoContenedor(
  value: string | null | undefined,
): value is TipoContenedor {
  const t = String(value ?? "").trim().toLowerCase();
  return t === "propio" || t === "amazon_agl";
}

/** @deprecated Legacy */
export function isEstadoContenedor(value: string): value is EstadoContenedor {
  return (ESTADOS_CONTENEDOR_ORDEN as string[]).includes(value);
}

export function labelEstadoLogisticoContenedor(estado: string): string {
  if (isEstadoLogisticoContenedor(estado)) return ESTADO_LOGISTICO_LABELS[estado];
  return estado;
}

export function labelEstadoStockContenedor(estado: string): string {
  if (isEstadoStockContenedor(estado)) return ESTADO_STOCK_LABELS[estado];
  return estado;
}

export function labelEstadoCostesContenedor(estado: string): string {
  if (isEstadoCostesContenedor(estado)) return ESTADO_COSTES_LABELS[estado];
  return estado;
}

/** @deprecated Legacy */
export function labelEstadoContenedor(estado: string): string {
  if (isEstadoContenedor(estado)) return ESTADO_CONTENEDOR_LABELS[estado];
  return estado;
}

export function shouldApplyStockOnEstadoStockChange(
  previousStock: string | null | undefined,
  newStock: string | null | undefined,
  tipoContenedor: string | null | undefined,
): boolean {
  const tipo = String(tipoContenedor ?? "").trim().toLowerCase();
  const isPropio = tipo === "propio" || tipo === "";
  return (
    newStock === ESTADO_STOCK_ACTIVA_APLICACION &&
    previousStock !== ESTADO_STOCK_ACTIVA_APLICACION &&
    isPropio
  );
}

/** @deprecated Usar shouldApplyStockOnEstadoStockChange */
export function shouldApplyStockOnEstadoChange(
  previousEstado: string | null | undefined,
  newEstado: string,
): boolean {
  return (
    newEstado === ESTADO_ACTIVA_STOCK_CONTENEDOR &&
    previousEstado !== ESTADO_ACTIVA_STOCK_CONTENEDOR
  );
}

export function isEstadoLogisticoPostTransito(estado: string): boolean {
  return estado === "entregado";
}

/** @deprecated Legacy — usar isEstadoLogisticoPostTransito con estado_logistico */
export function isEstadoContenedorPostTransito(estado: string): boolean {
  return (
    estado === "entregado" ||
    estado === ESTADO_ACTIVA_STOCK_CONTENEDOR ||
    estado === "facturado"
  );
}

export function isEstadoLogisticoPostTransitoResolved(
  estadoLogistico: string,
  estadoStock: string,
): boolean {
  return (
    isEstadoLogisticoPostTransito(estadoLogistico) ||
    estadoStock === ESTADO_STOCK_ACTIVA_APLICACION
  );
}
