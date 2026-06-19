export type AmazonFbaCountryImportMode = "preview" | "commit";

export type AmazonFbaCountrySource =
  | "amazon_fba_country_report"
  | (string & {});

export type ParsedFbaCountryRow = {
  rowNumber: number;
  skuOriginal: string;
  skuLimpio: string;
  pais: string;
  stockFba: number;
  snapshotDate: string;
  raw: Record<string, unknown>;
};

export type FbaCountryParseWarning = {
  row: number;
  message: string;
};

export type FbaCountryParseResult = {
  totalRows: number;
  twinlyRows: number;
  skippedNonTwinlyRows: number;
  skippedRows: number;
  skippedNoCountryRows: number;
  skippedNoStockRows: number;
  validRows: ParsedFbaCountryRow[];
  warnings: FbaCountryParseWarning[];
};

export type FbaCountryPreviewSampleRow = {
  snapshotDate: string;
  skuOriginal: string;
  skuLimpio: string;
  pais: string;
  stockFba: number;
  productLinked: boolean;
};

export type FbaCountryRowsByKey = {
  key: string;
  rows: number;
  stockFba: number;
};

export type FbaCountryUnlinkedSku = {
  skuLimpio: string;
  rows: number;
};

export type FbaCountryPreviewResponse = {
  ok: true;
  mode: "preview";
  totalRows: number;
  twinlyRows: number;
  validRows: number;
  importableRows: number;
  skippedNonTwinlyRows: number;
  skippedNoCountryRows: number;
  skippedNoStockRows: number;
  skippedUnlinkedRows: number;
  omittedUnlinkedRows: number;
  uniqueSkus: number;
  skipUnlinkedProducts: boolean;
  defaultPais: string | null;
  dateRange: { from: string | null; to: string | null };
  rowsByCountry: FbaCountryRowsByKey[];
  unlinkedSkus: FbaCountryUnlinkedSku[];
  warnings: FbaCountryParseWarning[];
  sampleRows: FbaCountryPreviewSampleRow[];
};

export type FbaCountryCommitResponse = {
  ok: true;
  mode: "commit";
  totalRows: number;
  twinlyRows: number;
  validRows: number;
  importableRows: number;
  skippedNonTwinlyRows: number;
  skippedNoCountryRows: number;
  skippedUnlinkedRows: number;
  omittedUnlinkedRows: number;
  inventarioPaisesUpserted: number;
  historySnapshotsUpserted: number;
  defaultPais: string | null;
  dateRange: { from: string | null; to: string | null };
  rowsByCountry: FbaCountryRowsByKey[];
  source: string;
  sourceFileName: string | null;
  warnings: FbaCountryParseWarning[];
};

export type AggregatedFbaCountryStock = {
  producto_id: string;
  sku_limpio: string;
  pais: string;
  marketplace_id: string | null;
  stock_fba: number;
  snapshot_date: string;
  raw: Record<string, unknown> | null;
};
