/**
 * IDs de marketplace Amazon (Seller Central).
 * Fallback si `amazon_marketplaces` no tiene el code o la fila aún no existe.
 */
export const AMAZON_MARKETPLACE_ID_BY_COUNTRY: Record<string, string> = {
  DE: "A1PA6795UKMFR9",
  ES: "A1RKKUPIHCS9HS",
  FR: "A13V1IB3VIYZZH",
  GB: "A1F8U78D6W0GOS",
  UK: "A1F8U78D6W0GOS",
  IT: "APJ6JRA9NG5V4",
  PL: "A1C37XSU9S960A",
  SE: "A2NODRK35VY8IU",
  NL: "A1805IZSGTT6HS",
  BE: "AMEN7PMS3EDWL",
};

export function resolveAmazonMarketplaceId(
  countryCode: string,
  fromDb: Map<string, string>,
): string | null {
  const code = countryCode.trim().toUpperCase();
  if (!code || code === "UNKNOWN") return null;

  const dbId = fromDb.get(code);
  if (dbId) return dbId;

  return AMAZON_MARKETPLACE_ID_BY_COUNTRY[code] ?? null;
}
