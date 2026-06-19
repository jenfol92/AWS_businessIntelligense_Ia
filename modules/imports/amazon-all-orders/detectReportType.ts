/**
 * Detecta el tipo de informe Amazon antes de parsear filas.
 * Evita confundir FBA Inventory Ledger con All Orders.
 */

export type AmazonImportReportType =
  | "all_orders"
  | "fba_inventory_ledger"
  | "unknown";

export class AllOrdersWrongReportTypeError extends Error {
  readonly code = "WRONG_REPORT_TYPE" as const;
  readonly detectedType: "fba_inventory_ledger" | "unknown";

  constructor(detectedType: "fba_inventory_ledger" | "unknown") {
    const message =
      detectedType === "fba_inventory_ledger"
        ? [
            "Archivo incorrecto: has subido un FBA Inventory Ledger.",
            "Este importador solo acepta Amazon All Orders.",
            "Usa el importador FBA Ledger Summary para stock.",
            "Para ventas_diarias necesitas un informe Amazon All Orders.",
          ].join("\n")
        : [
            "Este archivo no parece un informe Amazon All Orders.",
            "Se esperan columnas como amazon-order-id, purchase-date, sku y quantity.",
            "Para stock FBA usa el importador FBA Ledger Summary.",
          ].join("\n");
    super(message);
    this.name = "AllOrdersWrongReportTypeError";
    this.detectedType = detectedType;
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

function parseHeaderLine(firstLine: string, delimiter: string): Set<string> {
  const headers = new Set<string>();
  for (const cell of firstLine.split(delimiter)) {
    const normalized = normalizeImportHeader(cell);
    if (normalized) headers.add(normalized);
  }
  return headers;
}

function hasHeaders(headers: Set<string>, candidates: string[]): boolean {
  return candidates.every((name) => headers.has(normalizeImportHeader(name)));
}

function hasAnyHeader(headers: Set<string>, candidates: string[]): boolean {
  return candidates.some((name) => headers.has(normalizeImportHeader(name)));
}

/** Cabeceras distintivas de FBA Inventory Ledger (informe por país / detalle). */
const FBA_LEDGER_SIGNATURE = [
  "date",
  "fnsku",
  "msku",
  "disposition",
  "ending warehouse balance",
  "location",
];

/** Cabeceras mínimas esperadas en Amazon All Orders (referencia). */
export const ALL_ORDERS_HEADER_HINTS = [
  "amazon order id",
  "purchase date",
  "fulfillment channel",
  "sales channel",
  "sku",
  "quantity",
] as const;

const ALL_ORDERS_QUANTITY_ALIASES = ["quantity", "quantity purchased"];

/**
 * Detecta tipo de informe a partir de la primera línea (cabeceras).
 * @throws AllOrdersWrongReportTypeError si el archivo no es All Orders
 */
export function assertAllOrdersReportHeaders(
  firstLine: string,
  delimiter: string,
): AmazonImportReportType {
  const headers = parseHeaderLine(firstLine, delimiter);

  if (headers.size === 0) {
    throw new AllOrdersWrongReportTypeError("unknown");
  }

  if (hasHeaders(headers, FBA_LEDGER_SIGNATURE)) {
    throw new AllOrdersWrongReportTypeError("fba_inventory_ledger");
  }

  // Ledger parcial: Date + FNSKU + MSKU + Disposition sin All Orders
  const partialLedger =
    hasHeaders(headers, ["date", "fnsku", "msku", "disposition"]) &&
    hasAnyHeader(headers, [
      "ending warehouse balance",
      "starting warehouse balance",
      "customer shipments",
      "receipts",
    ]) &&
    !hasAnyHeader(headers, ["amazon order id", "purchase date"]);

  if (partialLedger) {
    throw new AllOrdersWrongReportTypeError("fba_inventory_ledger");
  }

  const hasOrderId = hasAnyHeader(headers, ["amazon order id"]);
  const hasPurchaseDate = hasAnyHeader(headers, ["purchase date"]);
  const hasSku = hasAnyHeader(headers, ["sku", "seller sku"]);
  const hasQuantity = ALL_ORDERS_QUANTITY_ALIASES.some((q) =>
    headers.has(normalizeImportHeader(q)),
  );

  const looksLikeAllOrders =
    (hasOrderId || hasPurchaseDate) && hasSku && hasQuantity;

  if (!looksLikeAllOrders) {
    throw new AllOrdersWrongReportTypeError("unknown");
  }

  return "all_orders";
}

export function detectReportTypeFromText(text: string): {
  delimiter: string;
  reportType: AmazonImportReportType;
} {
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const reportType = assertAllOrdersReportHeaders(firstLine, delimiter);
  return { delimiter, reportType };
}

function detectDelimiter(firstLine: string): string {
  const tab = (firstLine.match(/\t/g) ?? []).length;
  const semi = (firstLine.match(/;/g) ?? []).length;
  const comma = (firstLine.match(/,/g) ?? []).length;
  if (tab >= semi && tab >= comma && tab > 0) return "\t";
  if (semi > comma) return ";";
  return ",";
}
