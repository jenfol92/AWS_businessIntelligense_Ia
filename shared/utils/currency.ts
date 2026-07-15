export function formatCurrency(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null) return "-";

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "-";

  const normalizedCurrency = (currency || "USD").trim().toUpperCase();

  try {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: normalizedCurrency || "USD",
      maximumFractionDigits: 2,
    }).format(numericValue);
  } catch {
    const numberFormatted = new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numericValue);
    return `${numberFormatted} ${normalizedCurrency || currency || "USD"}`;
  }
}

export function formatEur(value: number | null | undefined): string {
  return formatCurrency(value, "EUR");
}
