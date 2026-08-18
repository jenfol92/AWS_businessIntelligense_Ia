export type LedgerLocationType = "COUNTRY" | "FC" | "OTHER" | "UNKNOWN";
export const LEDGER_LOCATION_UNCLASSIFIED = "LEDGER_LOCATION_UNCLASSIFIED" as const;

export type LedgerLocationEvidence = {
  knownCountryCodes?: ReadonlySet<string>;
  fulfillmentCenters?: ReadonlySet<string>;
  physicalCountryByCenter?: ReadonlyMap<string, string>;
  evidenceSourceByCenter?: ReadonlyMap<string, string>;
};

export function normalizeLedgerLocationRaw(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

export function classifyLedgerLocation(
  value: string | null | undefined,
  evidence: LedgerLocationEvidence = {},
) {
  const locationRaw = normalizeLedgerLocationRaw(value);
  if (!locationRaw) {
    return {
      locationRaw,
      locationType: "UNKNOWN" as const,
      physicalCountry: null,
      evidenceSource: null,
      evidenceConfidence: null,
      diagnosticStatus: null,
    };
  }
  if (evidence.knownCountryCodes?.has(locationRaw)) {
    return {
      locationRaw,
      locationType: "COUNTRY" as const,
      physicalCountry: locationRaw,
      evidenceSource: "LEDGER_ISO_COUNTRY",
      evidenceConfidence: "HIGH" as const,
      diagnosticStatus: null,
    };
  }
  if (evidence.fulfillmentCenters?.has(locationRaw)) {
    return {
      locationRaw,
      locationType: "FC" as const,
      physicalCountry: evidence.physicalCountryByCenter?.get(locationRaw) ?? null,
      evidenceSource:
        evidence.evidenceSourceByCenter?.get(locationRaw) ?? "PERSISTED_CORROBORATION",
      evidenceConfidence: "MEDIUM" as const,
      diagnosticStatus: null,
    };
  }
  return {
    locationRaw,
    locationType: "OTHER" as const,
    physicalCountry: null,
    evidenceSource: null,
    evidenceConfidence: null,
    diagnosticStatus: LEDGER_LOCATION_UNCLASSIFIED,
  };
}
