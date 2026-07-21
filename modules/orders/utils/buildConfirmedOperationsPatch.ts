/**
 * Módulo   : orders
 * Archivo  : modules/orders/utils/buildConfirmedOperationsPatch.ts
 * Qué hace : Helper puro que compara el estado operativo actual del
 *            formulario contra una línea base (último estado confirmado
 *            cargado o última respuesta guardada) y devuelve únicamente las
 *            claves realmente modificadas, listas para
 *            PATCH /api/orders/[id]/confirmed-operations.
 * No debe  : Incluir items, costes ni campos comerciales — la RPC
 *            update_confirmed_purchase_order_operations no los acepta.
 */

export type ConfirmedOperationsFields = {
  destino: string | null;
  tipo_envio: "propio" | "amazon_agl";
  etd: string | null;
  eta: string | null;
  eta_real: string | null;
  lead_time_produccion: number | null;
  lead_time_transito: number | null;
  agente_id: string | null;
  numero_pedido_agente: string | null;
  notas: string | null;
  tipo_cambio_moneda_eur: number | null;
};

export type ConfirmedOperationsPatch = Partial<
  Omit<ConfirmedOperationsFields, "tipo_envio"> & { tipo_envio: "propio" | "amazon_agl" }
>;

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/** Compara solo por fecha (YYYY-MM-DD); ignora hora/zona si llegara con ella. */
function normalizeDate(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed.slice(0, 10);
}

function normalizeNumber(value: number | string | null | undefined): number | null {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compara `current` contra `baseline` y devuelve un patch con exclusivamente
 * las claves cuyo valor normalizado cambió.
 *
 * - Sin cambio: la clave se omite.
 * - Campo de texto/fecha/número vaciado: la clave se incluye con `null`.
 * - `tipo_cambio_moneda_eur`: la RPC rechaza un `null` explícito (debe ser
 *   positivo si se envía), así que solo se incluye cuando el valor nuevo es
 *   un número positivo distinto del de la línea base; nunca se envía como
 *   `null` aunque el campo se haya vaciado en el formulario.
 */
export function buildConfirmedOperationsPatch(
  current: ConfirmedOperationsFields,
  baseline: ConfirmedOperationsFields,
): ConfirmedOperationsPatch {
  const patch: ConfirmedOperationsPatch = {};

  const destinoCurrent = normalizeText(current.destino);
  if (destinoCurrent !== normalizeText(baseline.destino)) {
    patch.destino = destinoCurrent;
  }

  if (current.tipo_envio !== baseline.tipo_envio) {
    patch.tipo_envio = current.tipo_envio;
  }

  const etdCurrent = normalizeDate(current.etd);
  if (etdCurrent !== normalizeDate(baseline.etd)) {
    patch.etd = etdCurrent;
  }

  const etaCurrent = normalizeDate(current.eta);
  if (etaCurrent !== normalizeDate(baseline.eta)) {
    patch.eta = etaCurrent;
  }

  const etaRealCurrent = normalizeDate(current.eta_real);
  if (etaRealCurrent !== normalizeDate(baseline.eta_real)) {
    patch.eta_real = etaRealCurrent;
  }

  const leadProduccionCurrent = normalizeNumber(current.lead_time_produccion);
  if (leadProduccionCurrent !== normalizeNumber(baseline.lead_time_produccion)) {
    patch.lead_time_produccion = leadProduccionCurrent;
  }

  const leadTransitoCurrent = normalizeNumber(current.lead_time_transito);
  if (leadTransitoCurrent !== normalizeNumber(baseline.lead_time_transito)) {
    patch.lead_time_transito = leadTransitoCurrent;
  }

  const agenteIdCurrent = normalizeText(current.agente_id);
  if (agenteIdCurrent !== normalizeText(baseline.agente_id)) {
    patch.agente_id = agenteIdCurrent;
  }

  const numeroPedidoAgenteCurrent = normalizeText(current.numero_pedido_agente);
  if (numeroPedidoAgenteCurrent !== normalizeText(baseline.numero_pedido_agente)) {
    patch.numero_pedido_agente = numeroPedidoAgenteCurrent;
  }

  const notasCurrent = normalizeText(current.notas);
  if (notasCurrent !== normalizeText(baseline.notas)) {
    patch.notas = notasCurrent;
  }

  const fxCurrent = normalizeNumber(current.tipo_cambio_moneda_eur);
  const fxBaseline = normalizeNumber(baseline.tipo_cambio_moneda_eur);
  if (fxCurrent != null && fxCurrent > 0 && fxCurrent !== fxBaseline) {
    patch.tipo_cambio_moneda_eur = fxCurrent;
  }

  return patch;
}
