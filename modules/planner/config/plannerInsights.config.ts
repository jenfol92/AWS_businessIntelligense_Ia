/**
 * Ventana de riesgo por Año Nuevo Chino (parón logístico en China).
 * Sin API externa: fechas fijas documentadas para adelantar pedidos.
 */
export const CHINESE_NEW_YEAR_RISK_WINDOW = {
  /** Inicio inclusivo: 15 de enero */
  startMonth: 1,
  startDay: 15,
  /** Fin inclusivo: 20 de febrero */
  endMonth: 2,
  endDay: 20,
  /** Días antes del inicio en los que también se advierte */
  daysBeforeWindow: 14,
} as const;

/** Umbral de pico de ventas: últimos 30 días vs media diaria de 90 días */
export const SALES_SPIKE_THRESHOLD = 1.3;
