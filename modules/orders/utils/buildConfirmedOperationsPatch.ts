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

export type ConfirmedOperationsPatch = Partial<ConfirmedOperationsFields>;

export class ConfirmedOperationsPatchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfirmedOperationsPatchValidationError";
  }
}

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
 * Solo devuelve claves modificadas; nunca incluye líneas ni datos comerciales.
 *
 * `finance_supplier_payments.amount_eur` es NOT NULL, aunque el tipo de cambio
 * y otros importes informativos sí admiten NULL. No existe por tanto una
 * limpieza atómica coherente con el esquema actual: un FX vacío, cero,
 * negativo o no finito se rechaza en vez de omitirse silenciosamente.
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

  const leadProduccionCurrent = normalizeNumber(
    current.lead_time_produccion,
  );
  if (
    leadProduccionCurrent !== normalizeNumber(baseline.lead_time_produccion)
  ) {
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

  const agentOrderCurrent = normalizeText(current.numero_pedido_agente);
  if (
    agentOrderCurrent !== normalizeText(baseline.numero_pedido_agente)
  ) {
    patch.numero_pedido_agente = agentOrderCurrent;
  }

  const notasCurrent = normalizeText(current.notas);
  if (notasCurrent !== normalizeText(baseline.notas)) {
    patch.notas = notasCurrent;
  }

  const fxCurrent = normalizeNumber(current.tipo_cambio_moneda_eur);
  if (fxCurrent == null || fxCurrent <= 0) {
    throw new ConfirmedOperationsPatchValidationError(
      "El tipo de cambio a EUR es obligatorio y debe ser un número positivo.",
    );
  }
  if (
    fxCurrent !== normalizeNumber(baseline.tipo_cambio_moneda_eur)
  ) {
    patch.tipo_cambio_moneda_eur = fxCurrent;
  }

  return patch;
}
