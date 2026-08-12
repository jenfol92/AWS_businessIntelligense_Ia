const SALES_CHANNEL_TO_COUNTRY: Record<string, string> = {
  "amazon.es": "ES",
  "amazon.fr": "FR",
  "amazon.de": "DE",
  "amazon.it": "IT",
  "amazon.co.uk": "GB",
  "amazon.com.be": "BE",
  "amazon.nl": "NL",
  "amazon.se": "SE",
  "amazon.pl": "PL",
  "amazon.ie": "IE",
  "amazon.ae": "AE",
  "amazon.sa": "SA",
};

const SALES_CHANNEL_TO_MARKETPLACE_ID: Record<string, string> = {
  "amazon.es": "A1RKKUPIHCS9HS",
  "amazon.fr": "A13V1IB3VIYZZH",
  "amazon.de": "A1PA6795UKMFR9",
  "amazon.it": "APJ6JRA9NG5V4",
  "amazon.co.uk": "A1F83G8C2ARO7P",
  "amazon.com.be": "AMEN7PMS3EDWL",
  "amazon.nl": "A1805IZSGTT6HS",
  "amazon.se": "A2NODRKZP88ZB9",
  "amazon.pl": "A1C3SOZRARQ6R3",
  "amazon.ie": "A28R8C7NBKEWEA",
  "amazon.ae": "A2VIGQ35RCS4UG",
};

export function salesChannelToMarketplaceCountry(
  salesChannel: string | null | undefined,
): string | null {
  const normalized = String(salesChannel ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  return SALES_CHANNEL_TO_COUNTRY[normalized] ?? null;
}

export function salesChannelToMarketplaceId(
  salesChannel: string | null | undefined,
): string | null {
  const normalized = String(salesChannel ?? "").trim().toLowerCase();
  if (!normalized) return null;
  return SALES_CHANNEL_TO_MARKETPLACE_ID[normalized] ?? null;
}

export function resolveFbaSaleCountry(params: {
  shipCountry: string | null | undefined;
  salesChannel: string | null | undefined;
  supportedCountries?: ReadonlySet<string>;
}): string | null {
  const shipCountry = String(params.shipCountry ?? "").trim().toUpperCase();
  const resolved = /^[A-Z]{2}$/.test(shipCountry)
    ? shipCountry
    : salesChannelToMarketplaceCountry(params.salesChannel);
  if (!resolved) return null;
  if (params.supportedCountries && !params.supportedCountries.has(resolved)) {
    return params.supportedCountries.has("UNKNOWN") ? "UNKNOWN" : null;
  }
  return resolved;
}
