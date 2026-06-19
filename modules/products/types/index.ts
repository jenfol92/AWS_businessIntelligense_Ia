// modules/products/types/index.ts

export type {
  ProductCatalogQuery,
  ProductCatalogRawRow,
  ProductCatalogItem,
  ProductCatalogResponse,
  ProductCatalogFilterOptions,
  ProductCatalogOptionsResponse,
} from "./catalog.types";

export type { ProductDetailQuery } from "./detail.types";

export type {
  ProductDetailResponse,
  ProductDetailMapperInput,
  ProductDetailParent,
  ProductDetailSibling,
  ProductDetailVariante,
  ProductDetailVentas,
  ProductDetailInventario,
  ProductDetailRentabilidad,
  ProductDetailDocumentoRel,
  ProductDetailLogisticaResumen,
  ProductEffectivePrice,
} from "./product-detail.types";

export type {
  ProductFormMode,
  ProductFormTab,
  ProductFormValues,
  ProductFormErrors,
  ProductFormDocumentRow,
  ProductCostCurrency,
  AmazonListingStatus,
  ProductFormFieldType,
  ProductFormFieldValue,
  ProductFormFieldValidation,
  ProductFormFieldConfig,
  ProductSupplierOption,
  ProductSupplierLogisticsInfo,
  ProductCategoryOption,
  AmazonMarketplaceCatalog,
  AmazonLanguageCode,
  ProductMarketplace,
  ProductAmazonContent,
  AmazonContentValidationWarning,
  AmazonContentQualityScore,
  AmazonMarketplaceContentDraft,
  ProductAmazonSetupFormValues,
  ProductAmazonSetupLoadResult,
} from "./form.types";

export type {
  CompetitorSelectionFilterResult,
  ProductCompetitorBenchmarkSelection,
  ProductCompetitorBenchmarkSelectionRawRow,
  SelectedCompetitorBenchmark,
  UpsertProductCompetitorBenchmarkSelectionInput,
  UpsertProductCompetitorBenchmarkSelectionRaw,
  ProductBenchmarkCompetitorRow,
  PutProductBenchmarkSelectionBody,
  PutProductBenchmarkSelectionItem,
  GetProductBenchmarkCompetitorsResponse,
  PutProductBenchmarkSelectionResponse,
} from "./competitor-benchmark-selection.types";
