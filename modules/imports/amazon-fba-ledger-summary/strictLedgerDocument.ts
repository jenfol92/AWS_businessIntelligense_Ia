import Papa from "papaparse";

export const LEDGER_MAX_BYTES = 8 * 1024 * 1024;
export const LEDGER_MAX_ROWS = 25000;
export class LedgerEvidenceError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "LedgerEvidenceError"; }
}
export const LEDGER_QUANTITY_COLUMNS = [
  "Starting Warehouse Balance", "In Transit Between Warehouses", "Receipts",
  "Customer Shipments", "Customer Returns", "Vendor Returns", "Warehouse Transfer In/Out",
  "Found", "Lost", "Damaged", "Disposed", "Other Events", "Ending Warehouse Balance", "Unknown Events",
] as const;
const normalized = (value: string) => value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g," ");
export function validLedgerDate(value: string): string | null {
  const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = slash ? `${slash[3]}-${slash[1].padStart(2,"0")}-${slash[2].padStart(2,"0")}` : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,10) === iso ? iso : null;
}
/** Blank quantities are NOT documented as zero. Reject them; explicit 0 is valid. */
export function strictLedgerInteger(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) throw new LedgerEvidenceError("LEDGER_EMPTY_QUANTITY");
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw)) throw new LedgerEvidenceError("LEDGER_INVALID_QUANTITY");
  const n = Number(raw.replace(/,/g,""));
  if (!Number.isSafeInteger(n) || n < -2147483648 || n > 2147483647) throw new LedgerEvidenceError("LEDGER_INVALID_QUANTITY");
  return n;
}
/** Reject the WHOLE document before returning any rows to a writer. */
export function parseStrictLedgerText(text: string): Papa.ParseResult<Record<string, unknown>> {
  if (Buffer.byteLength(text,"utf8") > LEDGER_MAX_BYTES) throw new LedgerEvidenceError("LEDGER_DOCUMENT_TOO_LARGE");
  const delimiter = text.split(/\r?\n/,1)[0].includes("\t") ? "\t" : ",";
  const header = Papa.parse<string[]>(text,{delimiter,preview:1}).data[0] ?? [];
  const keys = header.map(normalized);
  if (new Set(keys).size !== keys.length) throw new LedgerEvidenceError("LEDGER_DUPLICATE_COLUMN");
  const aliases = [["Date","Fecha"],["MSKU","Seller SKU","SKU"],["ASIN"],["FNSKU"],["Disposition"],["Location"],
    ...LEDGER_QUANTITY_COLUMNS.map(c=>c === "Warehouse Transfer In/Out" ? [c,"Warehouse Transfer In Out"] : [c])];
  const columns = aliases.map(names=>header.find(h=>names.some(n=>normalized(h)===normalized(n))));
  if (columns.some(c=>c===undefined)) throw new LedgerEvidenceError("LEDGER_MISSING_COLUMN");
  const parsed = Papa.parse<Record<string, unknown>>(text,{header:true,delimiter,skipEmptyLines:"greedy"});
  if (parsed.errors.length) throw new LedgerEvidenceError(`LEDGER_CSV_STRUCTURE_${parsed.errors[0].code}`);
  if (!parsed.data.length) throw new LedgerEvidenceError("LEDGER_EMPTY_DOCUMENT");
  if (parsed.data.length > LEDGER_MAX_ROWS) throw new LedgerEvidenceError("LEDGER_TOO_MANY_ROWS");
  for (const row of parsed.data) {
    const values = columns.map(c=>String(row[c!] ?? "").trim());
    if (!validLedgerDate(values[0])) throw new LedgerEvidenceError("LEDGER_INVALID_DATE");
    if (values.slice(1,6).some(v=>!v)) throw new LedgerEvidenceError("LEDGER_MISSING_IDENTITY");
    values.slice(6).forEach(strictLedgerInteger);
  }
  return parsed;
}
