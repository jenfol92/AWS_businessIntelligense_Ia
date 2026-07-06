export type AmazonInboundLogisticsFlow =
  | "fabrica_a_amazon"
  | "almacen_a_amazon"
  /** Alias legacy de lectura; no usar para escrituras nuevas. */
  | "proveedor_a_amazon"
  | "desconocido";

export type AmazonShipFromAddressInput = {
  Name?: unknown;
  name?: unknown;
  City?: unknown;
  city?: unknown;
  DistrictOrCounty?: unknown;
  districtOrCounty?: unknown;
  StateOrProvinceCode?: unknown;
  stateOrProvinceCode?: unknown;
  CountryCode?: unknown;
  countryCode?: unknown;
  AddressLine1?: unknown;
  addressLine1?: unknown;
  PostalCode?: unknown;
  postalCode?: unknown;
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const normalized = normalize(value);
    if (normalized) return normalized;
  }
  return "";
}

export function resolveAmazonInboundLogisticsFlow(
  shipFromAddress: AmazonShipFromAddressInput | null | undefined,
): AmazonInboundLogisticsFlow {
  const name = firstText(shipFromAddress?.Name, shipFromAddress?.name);
  const city = firstText(shipFromAddress?.City, shipFromAddress?.city);
  const district = firstText(
    shipFromAddress?.DistrictOrCounty,
    shipFromAddress?.districtOrCounty,
  );
  const state = firstText(
    shipFromAddress?.StateOrProvinceCode,
    shipFromAddress?.stateOrProvinceCode,
  );
  const countryCode = firstText(shipFromAddress?.CountryCode, shipFromAddress?.countryCode);

  if (
    countryCode === "es" &&
    (name.includes("impulsami") ||
      city.includes("orihuela") ||
      district.includes("san bartolome"))
  ) {
    return "almacen_a_amazon";
  }

  if (
    countryCode === "cn" ||
    name.includes("yongkang hydo") ||
    city.includes("yongkang") ||
    state.includes("zhejiang")
  ) {
    return "fabrica_a_amazon";
  }

  return "desconocido";
}
