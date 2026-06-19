// modules/products/types/competitor-benchmark-selection.types.ts

export type ProductCompetitorBenchmarkSelectionRawRow = {
  id: string;
  producto_id: string;
  marketplace_country: string;
  competitor_asin: string;
  competitor_title: string | null;
  is_selected: boolean;
  use_for_forecast: boolean;
  weight: number | null;
  capture_pct: number | null;
  snapshot_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductCompetitorBenchmarkSelection = {
  id: string;
  productoId: string;
  marketplaceCountry: string;
  competitorAsin: string;
  competitorTitle: string | null;
  isSelected: boolean;
  useForForecast: boolean;
  weight: number | null;
  capturePct: number | null;
  snapshotId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Competidor elegido para forecast (lectura / respuestas API). */
export type SelectedCompetitorBenchmark = Pick<
  ProductCompetitorBenchmarkSelection,
  | "productoId"
  | "marketplaceCountry"
  | "competitorAsin"
  | "competitorTitle"
  | "isSelected"
  | "useForForecast"
  | "weight"
  | "capturePct"
  | "snapshotId"
  | "notes"
>;

/** Payload upsert (camelCase). */
export type UpsertProductCompetitorBenchmarkSelectionInput = {
  productoId: string;
  marketplaceCountry: string;
  competitorAsin: string;
  competitorTitle?: string | null;
  isSelected?: boolean;
  useForForecast?: boolean;
  weight?: number | null;
  capturePct?: number | null;
  snapshotId?: string | null;
  notes?: string | null;
};

/** Payload upsert hacia Supabase (snake_case). */
export type UpsertProductCompetitorBenchmarkSelectionRaw = {
  producto_id: string;
  marketplace_country: string;
  competitor_asin: string;
  competitor_title?: string | null;
  is_selected?: boolean;
  use_for_forecast?: boolean;
  weight?: number | null;
  capture_pct?: number | null;
  snapshot_id?: string | null;
  notes?: string | null;
  updated_at?: string;
};

/** Sin filas en selección → usar snapshots como hasta ahora. */
export type CompetitorSelectionFilterResult =
  | { kind: "legacy_fallback" }
  | { kind: "explicit"; competitorAsins: string[] };

/** Fila combinada snapshot + selección para API GET. */
export type ProductBenchmarkCompetitorRow = {
  competitorAsin: string;
  competitorTitle: string | null;
  snapshotId: string | null;
  snapshotDate: string | null;
  price: number | null;
  rating: number | null;
  reviewCount: number | null;
  bsr: number | null;
  estimatedMonthlyUnits: number | null;
  estimatedMonthlyRevenue: number | null;
  source: string | null;
  isSelected: boolean;
  useForForecast: boolean;
  weight: number | null;
  capturePct: number | null;
  notes: string | null;
};

export type PutProductBenchmarkSelectionItem = {
  competitorAsin: string;
  competitorTitle?: string | null;
  snapshotId?: string | null;
  isSelected?: boolean;
  useForForecast?: boolean;
  weight?: number | null;
  capturePct?: number | null;
  notes?: string | null;
};

export type PutProductBenchmarkSelectionBody = {
  marketplaceCountry: string;
  competitors: PutProductBenchmarkSelectionItem[];
};

export type GetProductBenchmarkCompetitorsResponse = {
  ok: true;
  productId: string;
  marketplaceCountry: string;
  competitors: ProductBenchmarkCompetitorRow[];
};

export type PutProductBenchmarkSelectionResponse = {
  ok: true;
  saved: number;
};
