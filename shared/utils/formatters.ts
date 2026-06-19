// shared/utils/formatters.ts

/**
 * Formatea importes monetarios.
 * Sirve para precio, coste, beneficio, ventas, etc.
 */
export function formatCurrency(
    value: number | null | undefined,
    currency = "EUR"
  ): string {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return "—";
    }
  
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(Number(value));
  }
  
  /**
   * Formatea números normales.
   * Sirve para unidades, stock, días, etc.
   */
  export function formatNumber(
    value: number | null | undefined,
    maximumFractionDigits = 0
  ): string {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return "—";
    }
  
    return new Intl.NumberFormat("es-ES", {
      maximumFractionDigits,
    }).format(Number(value));
  }
  
  /**
   * Formatea porcentajes de forma inteligente.
   *
   * Acepta:
   * - 0.23  → 23%
   * - 23    → 23%
   *
   * Así evitamos errores si una vista SQL devuelve ratio o porcentaje.
   */
  export function formatPercentSmart(
    value: number | null | undefined,
    decimals = 1
  ): string {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return "—";
    }
  
    const numericValue = Number(value);
    const percent = Math.abs(numericValue) <= 1 ? numericValue * 100 : numericValue;
  
    return `${percent.toFixed(decimals)}%`;
  }
  
  /**
   * Formatea fechas.
   */
  export function formatDate(value: string | null | undefined): string {
    if (!value) return "—";
  
    const date = new Date(value);
  
    if (Number.isNaN(date.getTime())) return "—";
  
    return date.toLocaleDateString("es-ES");
  }