/**
 * Detecta informes GET_AFN_INVENTORY_DATA_BY_COUNTRY vs FBA Inventory Ledger.
 */

export class FbaCountryWrongReportTypeError extends Error {
  readonly code = "WRONG_REPORT_TYPE" as const;
  readonly detectedType = "fba_inventory_ledger" as const;

  constructor() {
    super(
      [
        "Este archivo parece FBA Inventory Ledger.",
        "Para stock FBA por país se recomienda GET_AFN_INVENTORY_DATA_BY_COUNTRY.",
        "Puedes usar Ledger Summary para stock total operativo, pero no se usará para actualizar stock por país.",
      ].join("\n"),
    );
    this.name = "FbaCountryWrongReportTypeError";
  }
}

export function normalizeImportHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}

function parseHeaders(firstLine: string, delimiter: string): Set<string> {
  const headers = new Set<string>();
  for (const cell of firstLine.split(delimiter)) {
    const h = normalizeImportHeader(cell);
    if (h) headers.add(h);
  }
  return headers;
}

function hasHeaders(headers: Set<string>, names: string[]): boolean {
  return names.every((n) => headers.has(normalizeImportHeader(n)));
}

function hasAnyHeader(headers: Set<string>, names: string[]): boolean {
  return names.some((n) => headers.has(normalizeImportHeader(n)));
}

/** Cabeceras distintivas del FBA Inventory Ledger (no BY_COUNTRY). */
const FBA_LEDGER_SIGNATURE = [
  "date",
  "fnsku",
  "msku",
  "disposition",
  "ending warehouse balance",
  "location",
];

/** Indicadores típicos de GET_AFN_INVENTORY_DATA_BY_COUNTRY. */
const BY_COUNTRY_STOCK_HEADERS = [
  "quantity available",
  "available",
  "fulfillable quantity",
  "afn fulfillable quantity",
  "sellable",
];

const BY_COUNTRY_COUNTRY_HEADERS = [
  "country",
  "country code",
  "marketplace country",
];

const BY_COUNTRY_SKU_HEADERS = [
  "sku",
  "seller sku",
  "msku",
  "merchant sku",
  "fnsku",
];

export function detectDelimiter(firstLine: string): string {
  const tab = (firstLine.match(/\t/g) ?? []).length;
  const semi = (firstLine.match(/;/g) ?? []).length;
  const comma = (firstLine.match(/,/g) ?? []).length;
  if (tab >= semi && tab >= comma && tab > 0) return "\t";
  if (semi > comma) return ";";
  return ",";
}

/**
 * Rechaza Ledger; valida que el archivo parezca BY_COUNTRY (o tenga defaultPais).
 * @throws FbaCountryWrongReportTypeError
 */
export function assertAfnInventoryByCountryHeaders(
  firstLine: string,
  delimiter: string,
  defaultPais?: string | null,
): void {
  const headers = parseHeaders(firstLine, delimiter);

  if (headers.size === 0) {
    throw new Error("El archivo no tiene cabeceras válidas.");
  }

  if (hasHeaders(headers, FBA_LEDGER_SIGNATURE)) {
    throw new FbaCountryWrongReportTypeError();
  }

  const partialLedger =
    hasHeaders(headers, ["date", "fnsku", "msku", "disposition"]) &&
    hasAnyHeader(headers, [
      "ending warehouse balance",
      "starting warehouse balance",
      "customer shipments",
      "receipts",
      "location",
    ]);

  if (partialLedger) {
    throw new FbaCountryWrongReportTypeError();
  }

  const hasSku = hasAnyHeader(headers, BY_COUNTRY_SKU_HEADERS);
  const hasStock = hasAnyHeader(headers, BY_COUNTRY_STOCK_HEADERS);
  const hasCountry =
    hasAnyHeader(headers, BY_COUNTRY_COUNTRY_HEADERS) ||
    Boolean(defaultPais?.trim());

  if (!hasSku || !hasStock || !hasCountry) {
    throw new Error(
      [
        "El archivo no parece GET_AFN_INVENTORY_DATA_BY_COUNTRY.",
        "Se esperan columnas de SKU, país (country / marketplace-country) y stock vendible",
        "(quantity-available, fulfillable-quantity, afn-fulfillable-quantity, available o sellable).",
        defaultPais
          ? `País por defecto configurado: ${defaultPais}.`
          : "Si el informe es de un solo país, selecciona el país por defecto.",
      ].join("\n"),
    );
  }
}

export function validateAfnInventoryByCountryFile(
  text: string,
  defaultPais?: string | null,
): { delimiter: string } {
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  assertAfnInventoryByCountryHeaders(firstLine, delimiter, defaultPais);
  return { delimiter };
}
