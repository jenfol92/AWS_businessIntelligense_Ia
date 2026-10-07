// shared/filters/types.ts

/** Periodo del filtro global: hoy, ventanas fijas o rango personalizado. */
export type PeriodPreset = "today" | "7" | "30" | "60" | "90" | "custom";

export type GlobalFilters = {
  /** Días del periodo (hoy = 1; personalizado = días del rango, inclusivo). */
  windowDays: number;
  periodPreset: PeriodPreset;
  /** YYYY-MM-DD. Solo informado para "today" y "custom"; en ventanas fijas lo calcula el backend. */
  periodFrom?: string | null;
  periodTo?: string | null;
  pais: string;
  canal: string;
};

export type GlobalFiltersContextValue = GlobalFilters & {
  /** Compatibilidad: fija una ventana de N días (7/30/60/90). */
  setWindowDays: (value: number) => void;
  setPeriodPreset: (value: PeriodPreset) => void;
  /** Fija un rango personalizado (YYYY-MM-DD, inclusivo). */
  setCustomPeriod: (from: string, to: string) => void;
  setPais: (value: string) => void;
  setCanal: (value: string) => void;
  resetFilters: () => void;
};
