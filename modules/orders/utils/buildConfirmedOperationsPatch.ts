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
};

export type ConfirmedOperationsPatch = Partial<ConfirmedOperationsFields>;

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeDate(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed.slice(0, 10);
}

function normalizeNumber(
  value: number | string | null | undefined,
): number | null {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Compara el estado operativo actual contra la última línea base confirmada.
 * Solo devuelve claves operativas modificadas; nunca incluye líneas, costes,
 * moneda comercial ni tipos de cambio.
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

  const productionCurrent = normalizeNumber(current.lead_time_produccion);
  if (
    productionCurrent !== normalizeNumber(baseline.lead_time_produccion)
  ) {
    patch.lead_time_produccion = productionCurrent;
  }

  const transitCurrent = normalizeNumber(current.lead_time_transito);
  if (transitCurrent !== normalizeNumber(baseline.lead_time_transito)) {
    patch.lead_time_transito = transitCurrent;
  }

  const agentCurrent = normalizeText(current.agente_id);
  if (agentCurrent !== normalizeText(baseline.agente_id)) {
    patch.agente_id = agentCurrent;
  }

  const agentOrderCurrent = normalizeText(current.numero_pedido_agente);
  if (
    agentOrderCurrent !== normalizeText(baseline.numero_pedido_agente)
  ) {
    patch.numero_pedido_agente = agentOrderCurrent;
  }

  const notesCurrent = normalizeText(current.notas);
  if (notesCurrent !== normalizeText(baseline.notas)) {
    patch.notas = notesCurrent;
  }

  return patch;
}
